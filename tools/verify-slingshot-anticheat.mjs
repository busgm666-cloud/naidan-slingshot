/**
 * 真机检测奶蛋弹弓无尽榜的服务端防刷规则。
 * 先执行 supabase/workshop.sql 和 supabase/slingshot_scores.sql，再运行：
 * npm run verify:slingshot-anticheat
 */
const SUPABASE = 'https://buueozmrxfjqcaiqyzhq.supabase.co/rest/v1';
const KEY = 'sb_publishable_dN25ruwymHdivLup377eLg_9WTi1cOt';
const suffix = Date.now().toString(36).slice(-4);

const submit = async (row) => {
  const res = await fetch(`${SUPABASE}/slingshot_scores`, {
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
  score: 10000,
  level: 1,
  pigs: 2,
  blocks: 0,
  bosses: 0,
  bonus: 0,
  run_seconds: 10,
};

const cases = [
  { label: '违禁亲属昵称', row: { ...base, name: `爸爸${suffix}` } },
  { label: '分数构成异常', row: { ...base, name: `分数${suffix}`, score: 999999 } },
  { label: '关卡速度异常', row: { ...base, name: `速度${suffix}`, score: 500000, level: 100, pigs: 100 } },
  { label: 'boss 数量异常', row: { ...base, name: `首领${suffix}`, score: 310000, level: 2, pigs: 2, bosses: 10 } },
  { label: '奖励不是整万', row: { ...base, name: `奖励${suffix}`, score: 10000, pigs: 1, bonus: 5000 } },
];

const probe = async (method) => {
  const res = await fetch(`${SUPABASE}/slingshot_scores?name=eq.__rbac_probe_none__`, {
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
  hint: missing ? '请先在 Supabase SQL Editor 执行 supabase/workshop.sql 和 supabase/slingshot_scores.sql' : undefined,
  results,
  rbac: { update: updateProbe, delete: deleteProbe },
}, null, 2));
if (!ok) process.exitCode = 1;
