/**
 * 真机检测跑酷排行榜的服务端防刷规则。
 * 先执行 supabase/run_scores.sql，再运行：npm run verify:anticheat
 * 三个用例都是非法成绩，正常不会写入任何排行榜记录。
 */
const SUPABASE = 'https://buueozmrxfjqcaiqyzhq.supabase.co/rest/v1';
const KEY = 'sb_publishable_dN25ruwymHdivLup377eLg_9WTi1cOt';
const suffix = Date.now().toString(36).slice(-4);

const submit = async (row) => {
  const res = await fetch(`${SUPABASE}/run_scores`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  return { status: res.status, text: await res.text() };
};

const base = {
  score: 100,
  meters: 50,
  coins: 0,
  stomps: 0,
  smashes: 0,
  run_seconds: 10,
  track: 'free',
};

const cases = [
  { label: '违禁昵称', row: { ...base, name: `加微信${suffix}` } },
  { label: '速度异常', row: { ...base, name: `速度${suffix}`, score: 1100, meters: 1000, run_seconds: 1 } },
  { label: '分数构成异常', row: { ...base, name: `分数${suffix}`, score: 9000 } },
];

const probe = async (method) => {
  const res = await fetch(`${SUPABASE}/run_scores?name=eq.__rbac_probe_none__`, {
    method,
    headers: {
      apikey: KEY,
      'Content-Type': 'application/json',
    },
    body: method === 'PATCH' ? '{"score":1}' : undefined,
  });
  return { status: res.status, blocked: res.status === 401 || res.status === 403 };
};

const results = [];
for (const item of cases) {
  try {
    const res = await submit(item.row);
    results.push({ label: item.label, ...res, rejected: res.status >= 400 });
  } catch (error) {
    results.push({ label: item.label, status: 0, text: error.message, rejected: false });
  }
}

const updateProbe = await probe('PATCH');
const deleteProbe = await probe('DELETE');
const missing = results.some((r) => r.status === 404);
const rbacOk = updateProbe.blocked && deleteProbe.blocked;
const ok = !missing && results.every((r) => r.rejected) && rbacOk;
console.log(JSON.stringify({
  ok,
  missingTable: missing,
  results,
  rbac: { update: updateProbe, delete: deleteProbe },
}, null, 2));
if (!ok) process.exitCode = 1;
