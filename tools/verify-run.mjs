/**
 * 跑酷模式自动验收：入口、8 个奶蛋、每日赛道、键盘/技能、排行榜读写、单文件版。
 * 用法：npm run verify:run
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8850;
const SUPABASE = 'https://buueozmrxfjqcaiqyzhq.supabase.co';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitServer = async (url) => {
  for (let i = 0; i < 50; i++) {
    try {
      await new Promise((resolve, reject) => http.get(url, (res) => { res.resume(); resolve(); }).on('error', reject));
      return;
    } catch { await sleep(100); }
  }
  throw new Error('静态服务器没起来');
};

const main = async () => {
  const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
  const rows = [
    { name: '测试第一名', score: 900, meters: 700, track: 'free' },
    { name: '测试第二名', score: 800, meters: 650, track: 'daily-20261018' },
  ];
  const failures = [];
  let browser;
  try {
    const base = `http://127.0.0.1:${PORT}/`;
    await waitServer(base);
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route(`${SUPABASE}/**`, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'apikey, content-type, prefer',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Content-Type': 'application/json',
      };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
      if (url.pathname.endsWith('/run_scores') && req.method() === 'POST') {
        const row = JSON.parse(req.postData() || '{}');
        rows.push(row);
        return route.fulfill({ status: 201, headers, body: '[]' });
      }
      const daily = url.searchParams.get('track')?.replace('eq.', '');
      const data = daily ? rows.filter((row) => row.track === daily) : rows;
      return route.fulfill({ status: 200, headers, body: JSON.stringify(data) });
    });
    page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') failures.push(`console.error: ${message.text()}`); });
    await page.goto(`${base}#run`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.NailongRun && window.NailongRun.state());
    await page.waitForFunction(() => !document.getElementById('runScreen').classList.contains('hide'));

    const eggs = await page.locator('#runPanel .egg').count();
    if (eggs !== 8) failures.push(`奶蛋数量=${eggs}，应为 8`);
    await page.locator('[data-act="modeDaily"]').click();
    const dailyTrack = await page.evaluate(() => window.NailongRun.state().track);
    if (!/^daily-\d{8}$/.test(dailyTrack)) failures.push(`每日赛道标识错误：${dailyTrack}`);

    await page.locator('[data-act="start"]').click();
    await page.waitForFunction(() => window.NailongRun.phase() === 'run');
    const before = await page.evaluate(() => window.NailongRun.state());
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await sleep(80);
    const afterInput = await page.evaluate(() => window.NailongRun.state());
    if (afterInput.p.lane === before.p.lane && afterInput.p.vy === 0) failures.push('键盘换道/跳跃没有生效');
    await page.evaluate(() => window.NailongRun.skill());
    const skill = await page.evaluate(() => window.NailongRun.state().power);
    if (!Object.values(skill).some((value) => value > 0 || value === true)) failures.push('技能按钮没有产生技能状态');
    await page.evaluate(() => { window.NailongRun.state().chaseDist = -100; });
    await sleep(250);
    if (await page.evaluate(() => window.NailongRun.phase()) !== 'dead') failures.push('追兵追上后没有进入结算页');

    await page.locator('#runName').fill('自动验收');
    await page.locator('[data-act="submit"]').click();
    await page.waitForFunction(() => document.getElementById('runMsg')?.textContent.includes('已上传'), null, { timeout: 5000 });
    if (!rows.some((row) => row.name === '自动验收')) failures.push('排行榜成绩没有发出 POST');
    await page.locator('[data-act="board"]').click();
    await page.waitForFunction(() => document.querySelector('#runBoard .board'));
    const boardText = await page.locator('#runBoard').textContent();
    if (!boardText.includes('测试第二名')) failures.push('排行榜没有渲染模拟成绩');
    const tabs = await page.locator('#runPanel .tabs [data-act]').count();
    if (tabs !== 3) failures.push(`排行榜标签数量=${tabs}，应为 3`);

    const single = path.join(root, 'dist', '奶蛋弹弓-单文件.html');
    const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await p2.goto(pathToFileURL(single).href + '#run', { waitUntil: 'load' });
    await p2.waitForFunction(() => window.NailongRun && window.NailongRun.state());
    const singleReady = await p2.evaluate(() => ({
      visible: !document.getElementById('runScreen').classList.contains('hide'),
      eggs: document.querySelectorAll('#runPanel .egg').length,
      canvas: document.querySelector('#runCanvas').width > 0,
    }));
    if (!singleReady.visible || singleReady.eggs !== 8 || !singleReady.canvas) failures.push(`单文件版初始化失败：${JSON.stringify(singleReady)}`);
    await p2.close();

    const report = { ok: failures.length === 0, failures, eggs, dailyTrack, singleReady };
    await fs.writeFile(path.join(root, 'shots', 'verify-run-report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, failures: [...failures, `致命错误: ${error.message}`] }, null, 2));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
};

main();
