/**
 * 奶蛋弹弓本轮验收：手机 HUD、无尽榜 UI/上传、亲属违禁词。
 * Supabase 请求全部在浏览器里拦截，不会往线上排行榜写测试数据。
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 8864;
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
let posted = null;

const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.mjs'), String(port)], { stdio: 'ignore' });
await sleep(600);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--mute-audio'] });

try {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/rest/v1/slingshot_scores**', async (route) => {
    if (route.request().method() === 'POST') {
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 201, body: '' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { name: '奶蛋王', score: 123000, level: 7, created_at: new Date().toISOString() },
        { name: '奶蛙克星', score: 88000, level: 5, created_at: new Date().toISOString() },
      ]),
    });
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__nai && window.__nai.imagesReady(), null, { timeout: 15000 });

  const moderation = await page.evaluate(() => ({
    father: window.WorkshopModeration.check('爸爸来了'),
    dad: window.WorkshopModeration.check('父亲'),
    uncle: window.WorkshopModeration.check('叔叔带我'),
    normal: window.WorkshopModeration.check('奶蛋王'),
  }));
  if (moderation.father.ok || moderation.dad.ok || moderation.uncle.ok || !moderation.normal.ok) {
    failures.push(`亲属违禁词判断异常：${JSON.stringify(moderation)}`);
  }

  await page.evaluate(() => window.__nai.start('level1'));
  await sleep(250);
  await page.evaluate(() => window.__nai.skipIntro());
  await sleep(200);
  const hud = await page.evaluate(() => {
    const selectors = ['#score', '#ammo', '#hudRight', '#btnExitLevel', '#zoomBox', '#btnSound', '#btnRestart'];
    const nodes = selectors.map((selector) => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      return {
        selector,
        inside: rect.left >= -0.5 && rect.right <= innerWidth + 0.5 && rect.top >= -0.5 && rect.bottom <= innerHeight + 0.5,
        rect: { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) },
      };
    });
    return { viewport: { width: innerWidth, height: innerHeight }, nodes };
  });
  const outside = hud.nodes.filter((node) => !node.inside);
  if (outside.length) failures.push(`320×568 HUD 越界：${JSON.stringify(outside)}`);

  await page.evaluate(() => window.__nai.scoreboard.open('all'));
  await page.waitForSelector('#scoreBoardList li');
  const boardRows = await page.locator('#scoreBoardList li').count();
  if (boardRows !== 2) failures.push(`排行榜渲染行数=${boardRows}，应为 2`);
  await page.evaluate(() => window.__nai.scoreboard.close());

  await page.setViewportSize({ width: 375, height: 667 });
  await page.evaluate(() => {
    window.__nai.loadEndless(1, 4242);
    window.__nai.skipIntro();
  });
  await sleep(250);
  await page.evaluate(() => window.__nai.clearStage());
  await sleep(3300);
  await page.evaluate(() => window.__nai.skipIntro());
  await sleep(150);

  for (let i = 0; i < 12; i++) {
    const state = await page.evaluate(() => window.__nai.state().state);
    if (state === 'over') break;
    if (state === 'aim') {
      await page.evaluate(() => window.__nai.shoot(15, 1));
      await sleep(70);
      await page.evaluate(() => window.__nai.forceEnd());
    }
    await sleep(650);
  }

  const ended = await page.evaluate(() => {
    const state = window.__nai.state();
    const panel = document.querySelector('#endScreen .panel').getBoundingClientRect();
    return {
      state: state.state,
      score: state.score,
      total: state.totalScore,
      computed: state.computedScore,
      formVisible: !document.querySelector('#slingshotSubmit').classList.contains('hide'),
      panelInside: panel.top >= -0.5 && panel.bottom <= innerHeight + 0.5,
    };
  });
  if (ended.state !== 'over') failures.push(`没有进入无尽结算，state=${ended.state}`);
  if (ended.score !== ended.computed || ended.total !== ended.computed) failures.push(`分数构成不一致：${JSON.stringify(ended)}`);
  if (!ended.formVisible) failures.push('无尽结算没有显示成绩上传框');
  if (!ended.panelInside) failures.push('375×667 无尽结算面板越界');

  // 结算后残余坍塌/清场不应再改成绩快照，否则会出现“成绩校验失败”
  await page.evaluate(() => window.__nai.clearStage());
  await sleep(500);
  const afterCollapse = await page.evaluate(() => window.__nai.scoreboard.stats());
  if (afterCollapse.finalScore !== ended.total) {
    failures.push(`结算后成绩快照发生变化：${JSON.stringify({ ended, afterCollapse })}`);
  }
  const submit = await page.evaluate(() => window.__nai.scoreboard.submit('奶蛋测试'));
  if (!submit.submitted || submit.formVisible) failures.push(`成绩上传 UI 未完成：${JSON.stringify(submit)}`);
  if (!posted) failures.push('没有发出排行榜 POST');
  else {
    const expected = posted.pigs * 5000 + posted.blocks * 500 + posted.bosses * 30000 + posted.bonus;
    if (posted.score !== expected) failures.push(`上传分数不能逐项重建：${JSON.stringify(posted)}`);
    if (posted.name !== '奶蛋测试' || posted.level < 1) failures.push(`上传字段异常：${JSON.stringify(posted)}`);
  }
  if (errors.length) failures.push(`页面异常：${errors.join(' | ')}`);
} finally {
  await browser.close();
  server.kill();
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  failures,
  posted,
}, null, 2));
if (failures.length) process.exitCode = 1;
