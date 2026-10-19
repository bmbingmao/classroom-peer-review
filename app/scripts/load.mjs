/**
 * 并发压测：50 个学生·5 秒内同时提交，验证不报错、不丢分、结果正确。
 * 用法：BASE=http://127.0.0.1:3992 node scripts/load.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3992';
const N = Number(process.env.N || 50);

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const m = c.match(/^sid=([^;]*)/);
      if (m) cookie = m[1] ? `sid=${m[1]}` : '';
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
    return data;
  };
}

const fail = [];
function ok(name, cond, extra) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    fail.push(name);
    console.log(`  ✗ ${name} ${extra !== undefined ? JSON.stringify(extra) : ''}`);
  }
}

async function main() {
  const admin = client();
  await admin('POST', '/api/auth/login', { username: 'admin', password: 'admin12345' });
  await admin('POST', '/api/auth/change-password', { oldPassword: 'admin12345', newPassword: 'admin6666' });
  await admin('POST', '/api/admin/teachers', { username: 'loadt', display_name: '压测老师', password: 'teach123' });

  const t = client();
  await t('POST', '/api/auth/login', { username: 'loadt', password: 'teach123' });
  const g = await t('POST', '/api/teacher/groups', { name: '压测班' });
  const text = Array.from({ length: N }, (_, i) => `L${String(i + 1).padStart(3, '0')},学生${i + 1}`).join('\n');
  await t('POST', `/api/teacher/groups/${g.id}/import`, { text });

  const act = await t('POST', '/api/teacher/activities', {
    type: 'score',
    title: '并发压测',
    startAt: Date.now() - 1000,
    endAt: Date.now() + 600_000,
    groupIds: [g.id],
    items: [
      { name: 'A', min: 1, max: 10, weight: 1 },
      { name: 'B', min: 1, max: 10, weight: 1 },
    ],
    targets: [{ anonLabel: '作品A' }, { anonLabel: '作品B' }],
  });

  // 登录 + 改密（串行，避免把并发写都堆在这一步）
  const clients = [];
  for (let i = 0; i < N; i++) {
    const c = client();
    const u = `L${String(i + 1).padStart(3, '0')}`;
    await c('POST', '/api/auth/login', { username: u, password: u });
    await c('POST', '/api/auth/change-password', { oldPassword: u, newPassword: `pw${u}` });
    clients.push(c);
  }
  console.log(`  · ${N} 个学生账号就绪`);

  // 取题目结构（用第一个学生）
  const d = await clients[0]('GET', `/api/student/activities/${act.id}`);
  const tpl = [];
  for (const tg of d.targets) for (const it of d.items) tpl.push({ targetId: tg.id, itemId: it.id });

  // 同时提交
  const started = Date.now();
  const results = await Promise.allSettled(
    clients.map((c, i) =>
      c('POST', `/api/student/activities/${act.id}/submit`, {
        scores: tpl.map((x) => ({ ...x, score: 1 + ((i + x.targetId + x.itemId) % 10) })),
      }),
    ),
  );
  const elapsed = Date.now() - started;
  const failed = results.filter((r) => r.status === 'rejected');

  console.log(`  · ${N} 个提交耗时 ${elapsed}ms`);
  ok(`${N} 人并发提交全部成功`, failed.length === 0, failed.slice(0, 3).map((r) => r.reason?.message));
  ok(`总耗时 < 5000ms（实际 ${elapsed}ms）`, elapsed < 5000);

  const res = await t('GET', `/api/teacher/results/${act.id}`);
  ok(`服务端记到 ${N} 份提交`, res.submittedCount === N, res.submittedCount);
  ok('没有人被判未交', res.absentees.length === 0, res.absentees.length);
  for (const tg of res.targets) {
    for (const it of tg.items) {
      if (it.n !== N) {
        ok(`${tg.anon_label}/item${it.itemId} 的有效人数应为 ${N}（实际 ${it.n}）`, false);
      }
    }
  }
  ok('每个对象每个项目的有效人数都等于总人数', res.targets.every((tg) => tg.items.every((it) => it.n === N)));
  ok('总分算得出来', res.targets.every((tg) => typeof tg.total === 'number'));

  // 积分：每人 +10，只发一次
  const me = await clients[0]('GET', '/api/auth/me');
  ok('参与者积分 = 10', me.points === 10, me.points);

  console.log('');
  if (fail.length === 0) {
    console.log(`并发压测通过（${N} 人）`);
    process.exit(0);
  }
  console.log(`失败 ${fail.length} 项`);
  process.exit(1);
}

main().catch((e) => {
  console.error('压测失败：', e.message);
  process.exit(1);
});
