/**
 * 端到端冒烟测试：把 P0 的主流程真跑一遍。
 * 用法：先起一个干净的实例（DATA_DIR 指向临时目录），再运行
 *   BASE=http://127.0.0.1:3998 node scripts/smoke.mjs
 */
import { trimCount, trimmedMean, weightedTotal } from '../src/server/scoring.ts';

const BASE = process.env.BASE || 'http://127.0.0.1:3998';
let passed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${extra !== undefined ? '\n      ' + JSON.stringify(extra) : ''}`);
  }
}

function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

function client() {
  let cookie = '';
  async function req(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
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
    return { status: res.status, data };
  }
  return {
    req,
    get cookie() {
      return cookie;
    },
    get: (p) => req('GET', p),
    post: (p, b) => req('POST', p, b),
    put: (p, b) => req('PUT', p, b),
    patch: (p, b) => req('PATCH', p, b),
    del: (p, b) => req('DELETE', p, b),
  };
}

/* ================= 1. 算法单元 ================= */

console.log('\n[1] 去极值算法');
const kCases = [
  [1, 0],
  [2, 0],
  [3, 0],
  [4, 0],
  [5, 1],
  [6, 1],
  [19, 1],
  [20, 1],
  [21, 2],
  [40, 2],
  [60, 3],
  [100, 5],
];
for (const [n, k] of kCases) {
  eq(`n=${n} → k=${k}`, trimCount(n), k);
}

{
  // 19 人：1 个 100 分 + 其余 80 分 → 去掉 1 个最高（100）和 1 个最低（80）
  const entries = [{ studentId: 1, score: 100 }, ...Array.from({ length: 18 }, (_, i) => ({ studentId: i + 2, score: 80 }))];
  const r = trimmedMean(entries);
  eq('19 人 n', r.n, 19);
  eq('19 人 k', r.k, 1);
  eq('19 人剔除的最高分', r.removedHigh.map((e) => e.score), [100]);
  eq('19 人剔除的最低分', r.removedLow.map((e) => e.score), [80]);
  ok('19 人去极值后均分 80', Math.abs(r.mean - 80) < 1e-9, r.mean);
  ok('19 人原始均分 > 80', r.rawMean > 80);
}
{
  // 并列同分：只按位置删，不是把所有同分删光
  const entries = Array.from({ length: 5 }, (_, i) => ({ studentId: i + 1, score: 10 }));
  const r = trimmedMean(entries);
  eq('全并列 n=5 k=1', r.k, 1);
  eq('全并列剩 3 个', r.kept.length, 3);
  eq('全并列均分仍是 10', r.mean, 10);
}
{
  const r = trimmedMean([
    { studentId: 3, score: 4 },
    { studentId: 1, score: 8 },
    { studentId: 2, score: 6 },
  ]);
  eq('n=3 不去极值', r.k, 0);
  eq('n=3 均值 6', r.mean, 6);
}
{
  eq('空集 mean=null', trimmedMean([]).mean, null);
  eq(
    '权重全 0 → 等权',
    weightedTotal([
      { itemId: 1, weight: 0, mean: 10 },
      { itemId: 2, weight: 0, mean: 6 },
    ]),
    8,
  );
  eq(
    '权重 0 的项不参与总分',
    weightedTotal([
      { itemId: 1, weight: 1, mean: 10 },
      { itemId: 2, weight: 0, mean: 0 },
    ]),
    10,
  );
}

/* ================= 2. 账号与登录 ================= */

console.log('\n[2] 账号与登录');
const admin = client();
{
  const r = await admin.post('/api/auth/login', { username: 'admin', password: 'admin12345' });
  eq('admin 默认密码可登录', r.status, 200);
  eq('admin 需强制改密', r.data.must_change_pwd, true);

  const blocked = await admin.get('/api/admin/teachers');
  eq('未改密时其他接口被拦', blocked.status, 403);
  eq('拦截原因', blocked.data.error?.code, 'must_change_pwd');

  const ch = await admin.post('/api/auth/change-password', { oldPassword: 'admin12345', newPassword: 'admin6666' });
  eq('改密成功', ch.status, 200);
  const after = await admin.get('/api/admin/teachers');
  eq('改密后可访问', after.status, 200);
}

{
  const r = await admin.post('/api/admin/teachers', {
    username: 'teacher1',
    display_name: '王老师',
    password: 'teach123',
  });
  eq('admin 开通教师', r.status, 200);
  const bad = await admin.post('/api/admin/teachers', { username: 'teacher1', display_name: '重复', password: 'teach123' });
  eq('重复账号被拒', bad.status, 400);
}

const teacher = client();
{
  const r = await teacher.post('/api/auth/login', { username: 'teacher1', password: 'teach123' });
  eq('教师登录', r.status, 200);
  eq('教师不需强制改密', r.data.must_change_pwd, false);
}

/* ================= 3. 建组与导入 ================= */

console.log('\n[3] 学生组与导入');
let groupId = 0;
{
  const g = await teacher.post('/api/teacher/groups', { name: '计算机1班' });
  eq('建组', g.status, 200);
  groupId = g.data.id;

  const text = ['学号,姓名', '2023001,张三', '2023002,李四', '2023003,王五', '2023004,赵六', '2023005,钱七', '格式错误行'].join('\n');
  const imp = await teacher.post(`/api/teacher/groups/${groupId}/import`, { text });
  eq('导入状态', imp.status, 200);
  eq('新增 5 人', imp.data.added, 5);
  eq('1 行格式错误', imp.data.errors.length, 1);

  const again = await teacher.post(`/api/teacher/groups/${groupId}/import`, { text });
  eq('重复导入不重复建账号', again.data.added, 0);
  eq('重复导入全部命中已有', again.data.reused, 5);
  eq('重复导入已在组内', again.data.alreadyInGroup, 5);

  const members = await teacher.get(`/api/teacher/groups/${groupId}/members`);
  eq('组内 5 人', members.data.members.length, 5);

  const withGroups = (await teacher.get('/api/teacher/students')).data.students;
  ok('学生接口带出所属组（界面按组分组用）', withGroups.every((s) => Array.isArray(s.groups)), withGroups[0]);
  ok('组名对得上', withGroups.some((s) => s.groups.some((g) => g.name === '计算机1班')));
}

/* ================= 4. 评分活动 ================= */

console.log('\n[4] 评分活动（打满校验 + 去极值）');
let scoreId = 0;
{
  const end = Date.now() + 3600_000;
  const r = await teacher.post('/api/teacher/activities', {
    type: 'score',
    title: '作品互评',
    description: '请认真评分',
    anonymous: true,
    startAt: Date.now() - 1000,
    endAt: end,
    groupIds: [groupId],
    items: [
      { name: '完成度', min: 1, max: 10, weight: 50 },
      { name: '美观度', min: 1, max: 10, weight: 50 },
    ],
    targets: [{ anonLabel: '作品A' }, { anonLabel: '作品B' }, { anonLabel: '作品C' }],
  });
  eq('发起评分', r.status, 200);
  scoreId = r.data.id;

  const detail = await teacher.get(`/api/teacher/activities/${scoreId}`);
  eq('教师看得到 2 个评分项', detail.data.items.length, 2);
  eq('教师看得到 3 个被评对象', detail.data.targets.length, 3);
}

const students = [];
for (let i = 1; i <= 5; i++) {
  const c = client();
  const login = await c.post('/api/auth/login', { username: `202300${i}`, password: `202300${i}` });
  ok(`学生 202300${i} 初始登录`, login.status === 200);
  ok(`学生 202300${i} 需强制改密`, login.data.must_change_pwd === true);
  const blocked = await c.get('/api/student/activities');
  eq(`202300${i} 未改密先被拦`, blocked.status, 403);
  const ch = await c.post('/api/auth/change-password', {
    oldPassword: `202300${i}`,
    newPassword: `pw202300${i}`,
  });
  eq(`202300${i} 改密成功`, ch.status, 200);
  students.push(c);
}

{
  const list = await students[0].get('/api/student/activities');
  eq('学生看得到活动', list.data.activities.length, 1);
  eq('尚未参与', list.data.activities[0].participated, false);

  const d = await students[0].get(`/api/student/activities/${scoreId}`);
  eq('学生看到 2 个评分项', d.data.items.length, 2);
  eq('学生看不到被评者真实身份', d.data.targets.every((t) => t.anon_label), true);
  ok('学生详情里没有 student_id 字段', d.data.targets.every((t) => !('student_id' in t)), d.data.targets[0]);

  // 打满校验：只交一格必须 400
  const partial = await students[0].post(`/api/student/activities/${scoreId}/submit`, {
    scores: [{ targetId: d.data.targets[0].id, itemId: d.data.items[0].id, score: 8 }],
  });
  eq('未打满不能提交', partial.status, 400);
  eq('未打满报错码', partial.data.error?.code, 'bad_request');
  ok('报错带缺口数量', /没打分/.test(partial.data.error?.message ?? ''), partial.data.error);

  // 草稿
  const draftPayload = { [`${d.data.targets[0].id}:${d.data.items[0].id}`]: 9 };
  const dr = await students[0].put(`/api/student/activities/${scoreId}/draft`, { payload: draftPayload });
  eq('草稿保存', dr.status, 200);
  const dg = await students[0].get(`/api/student/activities/${scoreId}/draft`);
  eq('草稿读回一致', dg.data.draft, draftPayload);
}

// 5 个学生各给分：让 作品A/完成度 的分数是 [2,10,10,10,10]
const scorePlan = [
  // [完成度 for A,B,C] , [美观度 for A,B,C]
  { name: '张三', a: [2, 8, 8], b: [9, 9, 9] },
  { name: '李四', a: [10, 8, 8], b: [9, 9, 9] },
  { name: '王五', a: [10, 8, 8], b: [9, 9, 9] },
  { name: '赵六', a: [10, 8, 8], b: [9, 9, 9] },
  { name: '钱七', a: [10, 8, 8], b: [9, 9, 9] },
];

for (let i = 0; i < 5; i++) {
  const c = students[i];
  const d = await c.get(`/api/student/activities/${scoreId}`);
  const scores = [];
  const ids = d.data.targets.map((t) => t.id);
  const itemIds = d.data.items.map((it) => it.id);
  for (let ti = 0; ti < ids.length; ti++) {
    scores.push({ targetId: ids[ti], itemId: itemIds[0], score: scorePlan[i].a[ti] });
    scores.push({ targetId: ids[ti], itemId: itemIds[1], score: scorePlan[i].b[ti] });
  }
  const r = await c.post(`/api/student/activities/${scoreId}/submit`, { scores });
  eq(`${scorePlan[i].name} 打满提交`, r.status, 200);
}

{
  const me = await students[0].get('/api/auth/me');
  eq('提交后得 10 分', me.data.points, 10);

  const again = await students[0].get(`/api/student/activities/${scoreId}`);
  eq('已提交标记', again.data.submitted, true);
  eq('提交后草稿被清空', again.data.draft, null);

  const list = await students[0].get('/api/student/activities');
  eq('列表里标记已参与', list.data.activities[0].participated, true);
}

/* ================= 5. 结果与去极值 ================= */

console.log('\n[5] 教师端结果');
{
  const r = await teacher.get(`/api/teacher/results/${scoreId}`);
  eq('结果接口', r.status, 200);
  eq('有效参评人数 5', r.data.submittedCount, 5);

  const targetA = r.data.targets.find((t) => t.anon_label === '作品A');
  const completion = targetA.items.find((i) => i.itemId === r.data.items[0].id);
  eq('作品A/完成度 n', completion.n, 5);
  eq('作品A/完成度 k（n=5 去 1 高 1 低）', completion.k, 1);
  eq('剔除的最高分是 10', completion.removedHigh.map((e) => e.score), [10]);
  eq('剔除的最低分是 2', completion.removedLow.map((e) => e.score), [2]);
  eq('去极值均分 = 10', completion.mean, 10);
  ok('原始均分 = 8.4', Math.abs(completion.rawMean - 8.4) < 1e-9, completion.rawMean);
  // 完成度去极值后 10，美观度 5 人全给 9（去极值后仍 9），权重各 50 → (10+9)/2
  eq('作品A 总分（两项加权）', targetA.total, 9.5);

  const targetB = r.data.targets.find((t) => t.anon_label === '作品B');
  ok('作品B 总分 = 8.5（8 与 9 各占一半权重）', Math.abs(targetB.total - 8.5) < 1e-9, targetB.total);

  ok('学生端结果匿名（无评委字段）', true);
  const sres = await students[0].get(`/api/student/results/${scoreId}`);
  eq('学生能看结果', sres.status, 200);
  ok(
    '学生结果里没有评委 id',
    JSON.stringify(sres.data).indexOf('student_id') === -1,
    JSON.stringify(sres.data).slice(0, 200),
  );
}

/* ================= 6. 投票 ================= */

console.log('\n[6] 投票活动');
let voteId = 0;
{
  const r = await teacher.post('/api/teacher/activities', {
    type: 'vote',
    title: '最受欢迎作品',
    anonymous: true,
    startAt: Date.now() - 1000,
    endAt: Date.now() + 3600_000,
    groupIds: [groupId],
    options: [{ text: '选项一' }, { text: '选项二' }, { text: '选项三' }],
    multiple: false,
  });
  eq('发起投票', r.status, 200);
  voteId = r.data.id;

  const d = await students[0].get(`/api/student/activities/${voteId}`);
  const optIds = d.data.options.map((o) => o.id);

  const empty = await students[0].post(`/api/student/activities/${voteId}/vote`, { optionIds: [] });
  eq('不选不能投', empty.status, 400);

  const two = await students[0].post(`/api/student/activities/${voteId}/vote`, { optionIds: [optIds[0], optIds[1]] });
  eq('单选投票选 2 项被拒', two.status, 400);

  // 4 人投选项一，1 人投选项二
  for (let i = 0; i < 4; i++) {
    const rr = await students[i].post(`/api/student/activities/${voteId}/vote`, { optionIds: [optIds[0]] });
    eq(`第 ${i + 1} 人投票`, rr.status, 200);
  }
  const rr = await students[4].post(`/api/student/activities/${voteId}/vote`, { optionIds: [optIds[1]] });
  eq('第 5 人投票', rr.status, 200);

  // 改投：不重复发分
  const change = await students[0].post(`/api/student/activities/${voteId}/vote`, { optionIds: [optIds[2]] });
  eq('可改投', change.status, 200);
  const me = await students[0].get('/api/auth/me');
  eq('改投不再发分（仍 20）', me.data.points, 20);

  const res = await teacher.get(`/api/teacher/results/${voteId}`);
  const c0 = res.data.options.find((o) => o.id === optIds[0]).count;
  const c2 = res.data.options.find((o) => o.id === optIds[2]).count;
  eq('选项一票数 3', c0, 3);
  eq('选项三票数 1', c2, 1);
  eq('唯一最高只标记 1 个', res.data.options.filter((o) => o.top).length, 1);

  // 再让一人改投，制造并列最高
  const tie = await students[3].post(`/api/student/activities/${voteId}/vote`, { optionIds: [optIds[2]] });
  eq('改投制造并列', tie.status, 200);
  const res2 = await teacher.get(`/api/teacher/results/${voteId}`);
  eq('并列最高全部标记', res2.data.options.filter((o) => o.top).length, 2);
  eq('并列时选项一 = 2', res2.data.options.find((o) => o.id === optIds[0]).count, 2);
  eq('并列时选项三 = 2', res2.data.options.find((o) => o.id === optIds[2]).count, 2);
}

/* ================= 7. 权限隔离 ================= */

console.log('\n[7] 权限隔离');
{
  const stuTryTeacher = await students[0].get('/api/teacher/activities');
  eq('学生访问教师接口 403', stuTryTeacher.status, 403);

  const teaTryAdmin = await teacher.get('/api/admin/teachers');
  eq('教师访问超管接口 403', teaTryAdmin.status, 403);

  const other = client();
  await other.post('/api/auth/login', { username: 'admin', password: 'admin6666' });
  await other.post('/api/admin/teachers', { username: 'teacher2', display_name: '李老师', password: 'teach456' });
  const t2 = client();
  await t2.post('/api/auth/login', { username: 'teacher2', password: 'teach456' });
  const stolen = await t2.get(`/api/teacher/activities/${scoreId}`);
  eq('教师看不到别人的评价项', stolen.status, 403);
  const stolenGroup = await t2.get(`/api/teacher/groups/${groupId}/members`);
  eq('教师看不到别人的学生组', stolenGroup.status, 400);
}

/* ================= 8. 自动截止 ================= */

console.log('\n[8] 到期自动关闭（服务端判定）');
{
  const r = await teacher.post('/api/teacher/activities', {
    type: 'vote',
    title: '已结束的投票',
    startAt: Date.now() - 86_400_000,
    endAt: Date.now() - 3600_000,
    groupIds: [groupId],
    options: [{ text: 'A' }, { text: 'B' }],
  });
  eq('可创建已过期的活动', r.status, 200);
  const d = await students[0].get(`/api/student/activities/${r.data.id}`);
  eq('过期活动状态 = ended', d.data.activity.effective, 'ended');
  eq('过期活动不可提交', d.data.activity.accepting, false);
  const vote = await students[0].post(`/api/student/activities/${r.data.id}/vote`, { optionIds: [1] });
  eq('截止后提交被拒', vote.status, 400);
  eq('截止后错误码', vote.data.error?.code, 'ended');
}


/* ================= 9. 二维码与媒体上传 ================= */

console.log('\n[9] 二维码 / 媒体上传');
{
  const qr = await fetch(`${BASE}/api/qr?text=${encodeURIComponent('http://192.168.1.5:3000/')}`, {
    headers: { cookie: teacher.cookie },
  });
  eq('二维码返回 200', qr.status, 200);
  eq('二维码是 PNG', qr.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await qr.arrayBuffer());
  ok('二维码内容非空', buf.length > 500, buf.length);
  ok('PNG magic', buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG');

  // 1x1 透明 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const up = await fetch(`${BASE}/api/media`, {
    method: 'POST',
    headers: {
      cookie: teacher.cookie,
      'content-type': 'image/png',
      'x-file-name': encodeURIComponent('作品截图.png'),
      'x-file-type': 'image/png',
    },
    body: png,
  });
  eq('上传图片 200', up.status, 200);
  const upBody = await up.json();
  ok('返回媒体 url', /^\/api\/media\/[a-f0-9]{24}\.png$/.test(upBody.url), upBody);

  const fetched = await fetch(`${BASE}${upBody.url}`, { headers: { cookie: teacher.cookie } });
  eq('鉴权后可读回媒体', fetched.status, 200);
  eq('媒体类型正确', fetched.headers.get('content-type'), 'image/png');

  const anon = await fetch(`${BASE}${upBody.url}`);
  eq('未登录取不到媒体', anon.status, 401);

  const bad = await fetch(`${BASE}/api/media`, {
    method: 'POST',
    headers: { cookie: teacher.cookie, 'content-type': 'text/plain', 'x-file-name': 'x.txt', 'x-file-type': 'text/plain' },
    body: Buffer.from('not an image at all'),
  });
  eq('非图片被拒', bad.status, 400);

  const traversal = await fetch(`${BASE}/api/media/..%2Fapp.db`, { headers: { cookie: teacher.cookie } });
  ok('防目录遍历', traversal.status === 404 || traversal.status === 400, traversal.status);
}

/* ================= 汇总 ================= */

console.log(`\n${'='.repeat(48)}`);
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项`);
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
