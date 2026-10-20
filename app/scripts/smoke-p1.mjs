/**
 * P1 冒烟：评语 + AI 审核 + 表情积分 + 排行榜 + 小眼睛 + Excel 导出
 * 用法：BASE=http://127.0.0.1:3986 node scripts/smoke-p1.mjs
 * 前提：实例已跑过 scripts/seed.mjs（有 teacher1 / 8 个学生 / 两个活动）
 */
import http from 'node:http';
import ExcelJS from 'exceljs';

const BASE = process.env.BASE || 'http://127.0.0.1:3986';
// 容器里测时 127.0.0.1 指向容器自己，要传宿主机 IP（AI_HOST=192.168.x.x）
const AI_HOST = process.env.AI_HOST || '127.0.0.1';
let passed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${extra !== undefined ? '\n      ' + JSON.stringify(extra).slice(0, 300) : ''}`);
  }
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), { actual: a, expected: b });

function client() {
  let cookie = '';
  async function req(method, path, body, raw = false) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const m = c.match(/^sid=([^;]*)/);
      if (m) cookie = m[1] ? `sid=${m[1]}` : '';
    }
    if (raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
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
    cookie: () => cookie,
    get: (p) => req('GET', p),
    post: (p, b) => req('POST', p, b),
    put: (p, b) => req('PUT', p, b),
    getRaw: (p) => req('GET', p, undefined, true),
    delete: (p) => req('DELETE', p),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= 0. 登录 ================= */
console.log('\n[0] 准备账号');
const teacher = client();
{
  const r = await teacher.post('/api/auth/login', { username: 'teacher1', password: 'teach123' });
  eq('教师登录', r.status, 200);
}
const students = {};
for (const [u, p] of [
  ['2023001', 'pw2023001'],
  ['2023002', 'pw2023002'],
  ['2023004', 'pw2023004'],
  ['2023005', 'pw2023005'],
  ['2023006', 'pw2023006'],
  ['2023007', '2023007'],
]) {
  const c = client();
  const r = await c.post('/api/auth/login', { username: u, password: p });
  ok(`登录 ${u}`, r.status === 200 || r.status === 200, r.data);
  if (r.data?.must_change_pwd) {
    await c.post('/api/auth/change-password', { oldPassword: p, newPassword: `pw${u}` });
  }
  students[u] = c;
}

// 用 2023007 当"写评语的人"
const author = students['2023007'];
const scoreAct = (await teacher.get('/api/teacher/activities?type=score')).data.activities[0];
const voteAct = (await teacher.get('/api/teacher/activities?type=vote')).data.activities[0];
ok('拿到评分活动', !!scoreAct);
ok('拿到投票活动', !!voteAct);

/* ================= 1. 评语：待审 → 放行 / 驳回 ================= */
console.log('\n[1] 评语与人工审核');
let commentId = 0;
{
  const detail = (await author.get(`/api/student/activities/${scoreAct.id}`)).data;
  const scores = [];
  for (const t of detail.targets) for (const it of detail.items) scores.push({ targetId: t.id, itemId: it.id, score: 8 });
  const r = await author.post(`/api/student/activities/${scoreAct.id}/submit`, {
    scores,
    comment: '作品配色很舒服，但第三个场景的构图有点空',
    commentTargetId: detail.targets[0].id,
  });
  eq('带评语提交评分', r.status, 200);

  const wall = (await author.get(`/api/student/activities/${scoreAct.id}/comments`)).data;
  eq('未审核的评语不上墙', wall.comments.length, 0);

  const pending = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments?status=pending`)).data;
  eq('教师能看到待审 1 条', pending.comments.length, 1);
  ok('待审列表默认不带作者姓名（要真名走小眼睛接口）', !('author_name' in pending.comments[0]) && !('author_username' in pending.comments[0]), Object.keys(pending.comments[0]));
  commentId = pending.comments[0].id;

  const results = (await teacher.get(`/api/teacher/results/${scoreAct.id}`)).data;
  ok('结果页带待审计数（红点用）', results.pendingComments >= 1, results.pendingComments);

  const approve = await teacher.post(`/api/teacher/comments/${commentId}/moderate`, { action: 'approve' });
  eq('教师放行', approve.status, 200);
  const wall2 = (await author.get(`/api/student/activities/${scoreAct.id}/comments`)).data;
  eq('放行后学生能看到', wall2.comments.length, 1);
  ok('学生端评语里没有作者身份', !('author_name' in wall2.comments[0]) && !('student_id' in wall2.comments[0]), wall2.comments[0]);

  // 驳回
  await author.post(`/api/student/activities/${scoreAct.id}/submit`, {
    scores,
    comment: '这条会被驳回',
    commentTargetId: detail.targets[0].id,
  });
  const pending2 = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments?status=pending`)).data;
  eq('改评语后重新进入待审', pending2.comments.length, 1);
  eq('同一评委同一对象只有一条评语', (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments`)).data.comments.length, 1);
  const reject = await teacher.post(`/api/teacher/comments/${pending2.comments[0].id}/moderate`, {
    action: 'reject',
    reason: '与作品无关',
  });
  eq('教师驳回', reject.status, 200);
  const wall3 = (await author.get(`/api/student/activities/${scoreAct.id}/comments`)).data;
  eq('驳回的评语不上墙', wall3.comments.length, 0);
}

/* ================= 2. 小眼睛 ================= */
console.log('\n[2] 小眼睛（身份揭示走独立接口）');
{
  const results = (await teacher.get(`/api/teacher/results/${scoreAct.id}`)).data;
  const json = JSON.stringify(results.targets);
  ok('结果接口里没有被评者真名', !json.includes('张三') && !json.includes('李四'), json.slice(0, 200));
  ok('结果接口里没有评委真名', !json.includes('王五') && !json.includes('赵六'));
  ok('剔除标注用匿名编号', json.includes('评委'), json.slice(0, 300));

  const ident = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/identities`)).data;
  ok('小眼睛接口给出作品真实对应人', ident.targets.length >= 1 && !!ident.targets[0].name, ident.targets[0]);
  ok('小眼睛接口给出评委名单', ident.judges.length >= 1, ident.judges);
  ok('小眼睛接口给出评语作者映射', Array.isArray(ident.commentAuthors) && ident.commentAuthors.length >= 1, ident.commentAuthors);

  const stu = students['2023008'] || students['2023007'];
  const denied = await stu.get(`/api/teacher/activities/${scoreAct.id}/identities`);
  eq('学生访问小眼睛接口 403', denied.status, 403);
}

/* ================= 3. 表情与积分 ================= */
console.log('\n[3] 表情：扣分 / 加分 / 防刷 / 折叠');
{
  // 确保墙上有一条已通过的评语
  const all = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments`)).data.comments;
  const seeded = all[0];
  ok('活动里已有评语', !!seeded, all.length);
  if (seeded && seeded.moderation_status !== 'approved') {
    await teacher.post(`/api/teacher/comments/${seeded.id}/moderate`, { action: 'approve' });
  }
  const wall = (await author.get(`/api/student/activities/${scoreAct.id}/comments`)).data;
  ok('评语墙有可互动的评语', wall.comments.length >= 1, wall.comments.length);
  const target = wall.comments[0];

  const other = students['2023005'];
  const before = (await other.get('/api/student/points')).data.points;
  const authorPointsBefore = (await author.get('/api/student/points')).data.points;

  const r1 = await other.post(`/api/student/comments/${target.id}/reaction`, { emoji: '👍' });
  eq('发表情成功', r1.status, 200);
  const afterOther = (await other.get('/api/student/points')).data.points;
  const afterAuthor = (await author.get('/api/student/points')).data.points;
  eq('发表情扣 5 分', before - afterOther, 5);
  eq('作者收到正面表情 +1', afterAuthor - authorPointsBefore, 1);

  // 换表情：不再扣分、不再加分
  const r2 = await other.post(`/api/student/comments/${target.id}/reaction`, { emoji: '🔥' });
  eq('换表情成功', r2.status, 200);
  eq('换表情不再扣分', (await other.get('/api/student/points')).data.points, afterOther);
  eq('换表情不重复给作者加分', (await author.get('/api/student/points')).data.points, afterAuthor);

  const counts = (await other.get(`/api/student/activities/${scoreAct.id}/comments`)).data.comments[0].reactions;
  eq('计数只算最后一次表情', counts, { '🔥': 1 });

  // 给自己发表情
  const self = await author.post(`/api/student/comments/${target.id}/reaction`, { emoji: '👍' });
  eq('不能给自己发表情', self.status, 400);

  // 积分不足
  const poor = client();
  await poor.post('/api/auth/login', { username: '2023008', password: '2023008' });
  await poor.post('/api/auth/change-password', { oldPassword: '2023008', newPassword: 'pw2023008' });
  const poorTry = await poor.post(`/api/student/comments/${target.id}/reaction`, { emoji: '👍' });
  eq('0 分不能发表情', poorTry.status, 400);
  ok('提示积分不足', /积分不足/.test(poorTry.data?.error?.message ?? ''), poorTry.data);

  // 🚨 5 个不同学生 → 折叠
  const alarmUsers = ['2023001', '2023002', '2023004', '2023005', '2023006'];
  for (const u of alarmUsers) {
    const c = students[u];
    if (!c) continue;
    await c.post(`/api/student/comments/${target.id}/reaction`, { emoji: '🚨' });
  }
  const teacherView = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments`)).data.comments.find((c) => c.id === target.id);
  ok('5 人发🚨后自动折叠', teacherView?.folded === 1, teacherView?.folded);
  const wallAfterFold = (await other.get(`/api/student/activities/${scoreAct.id}/comments`)).data;
  ok('折叠后学生看不到', wallAfterFold.comments.every((c) => c.id !== target.id));

  const restore = await teacher.post(`/api/teacher/comments/${target.id}/fold`, { folded: false });
  eq('教师可恢复', restore.status, 200);
  const wallRestored = (await other.get(`/api/student/activities/${scoreAct.id}/comments`)).data;
  ok('恢复后学生又能看到', wallRestored.comments.some((c) => c.id === target.id));
}

/* ================= 4. 积分榜与手动加减分 ================= */
console.log('\n[4] 积分');
{
  const lb = (await teacher.get('/api/teacher/points/leaderboard')).data;
  ok('教师能看排行榜', lb.rows.length >= 8, lb.rows.length);
  ok('排行榜按分数降序', lb.rows.every((r, i) => i === 0 || lb.rows[i - 1].points >= r.points));

  const stu = students['2023007'];
  const before = (await stu.get('/api/student/points')).data.points;
  const adjust = await teacher.post('/api/teacher/points/adjust', { delta: 5, reason: '课堂积极发言', studentId: (await stu.get('/api/auth/me')).data.user.id });
  eq('教师加分', adjust.status, 200);
  eq('加分生效', (await stu.get('/api/student/points')).data.points, before + 5);

  const mine = (await stu.get('/api/student/points')).data;
  ok('学生能看自己的流水', mine.ledger.length >= 2, mine.ledger.length);
  ok('流水带原因', mine.ledger.some((l) => String(l.reason).includes('课堂积极发言')), mine.ledger.map((l) => l.reason));

  const mineBoard = (await stu.get('/api/student/points/leaderboard')).data;
  ok('学生能看班级榜', mineBoard.rows.length >= 8 && mineBoard.myRank >= 1, mineBoard.myRank);

  // 不能给学生减成负数
  const sid = (await stu.get('/api/auth/me')).data.user.id;
  const tooBig = await teacher.post('/api/teacher/points/adjust', { delta: -99999, reason: '超范围', studentId: sid });
  eq('单次加减分超过 1000 被拒', tooBig.status, 400);
  const before2 = (await stu.get('/api/student/points')).data.points;
  await teacher.post('/api/teacher/points/adjust', { delta: -1000, reason: '扣分', studentId: sid });
  const after2 = (await stu.get('/api/student/points')).data.points;
  ok('积分可以扣成负数', after2 < 0, { before2, after2 });
  eq('扣分金额准确', before2 - after2, 1000);

  // 负分不能发表情：先让另一个学生写一条并放行
  {
    const other = students['2023001'];
    const d2 = (await other.get(`/api/student/activities/${scoreAct.id}`)).data;
    const sc2 = [];
    for (const t of d2.targets) for (const it of d2.items) sc2.push({ targetId: t.id, itemId: it.id, score: 7 });
    await other.post(`/api/student/activities/${scoreAct.id}/submit`, {
      scores: sc2,
      comments: [{ targetId: d2.targets[0].id, content: '节奏可以再紧凑一些' }],
    });
    const p2 = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments?status=pending`)).data.comments;
    const mine = p2.find((c) => c.content.includes('节奏可以再紧凑'));
    if (mine) await teacher.post(`/api/teacher/comments/${mine.id}/moderate`, { action: 'approve' });
  }

  const negTry = await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments`);
  const anyApproved = negTry.data.comments.find((c) => c.moderation_status === 'approved' && c.student_id !== sid);
  ok('找到一条别人写的已通过评语', !!anyApproved, negTry.data.comments.map((c) => [c.id, c.student_id, c.moderation_status]));
  if (anyApproved) {
    const r = await stu.post(`/api/student/comments/${anyApproved.id}/reaction`, { emoji: '👍' });
    eq('负分不能发表情', r.status, 400);
    ok('提示积分不足', /积分不足/.test(r.data?.error?.message ?? ''), r.data);
  }
}

/* ================= 5. Excel 导出 ================= */
console.log('\n[5] Excel 导出');
{
  const res = await teacher.getRaw(`/api/teacher/activities/${scoreAct.id}/export`);
  eq('导出返回 200', res.status, 200);
  ok('是 xlsx（PK 头）', res.buf[0] === 0x50 && res.buf[1] === 0x4b, res.buf.subarray(0, 4));
  ok('文件不小', res.buf.length > 5000, res.buf.length);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.buf);
  const names = wb.worksheets.map((w) => w.name);
  ok('包含活动概览', names.includes('活动概览'), names);
  ok('包含评分原始分明细', names.includes('评分原始分明细'), names);
  ok('包含去极值结果', names.includes('去极值结果'), names);
  ok('包含评语表', names.includes('评语表'), names);
  ok('包含积分表', names.includes('积分表'), names);

  const overview = wb.getWorksheet('活动概览');
  const text = overview.getSheetValues().flat().join(' ');
  ok('概览写明导出含真实姓名', text.includes('真实姓名'), text.slice(0, 200));

  const raw = wb.getWorksheet('评分原始分明细');
  const rawText = raw.getSheetValues().flat().join(' ');
  ok('原始分明细带学号', /\d{7}/.test(rawText), rawText.slice(0, 200));
  ok('原始分明细标注被剔除的分数', rawText.includes('被剔除'), rawText.slice(0, 300));

  const logs = (await teacher.get('/api/teacher/exports')).data.logs;
  ok('导出留痕', logs.length >= 1 && logs[0].include_identity === 1, logs[0]);

  // 投票导出
  const voteRes = await teacher.getRaw(`/api/teacher/activities/${voteAct.id}/export`);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(voteRes.buf);
  ok('投票导出含投票明细', wb2.worksheets.map((w) => w.name).includes('投票明细'));
}

/* ================= 6. AI 审核（本地 mock 服务） ================= */
console.log('\n[6] AI 审核');
{
  const calls = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const content = JSON.parse(body || '{}')?.messages?.[1]?.content ?? '';
      calls.push(content);
      if (req.url?.startsWith('/slow')) {
        return setTimeout(() => res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] })), 12000);
      }
      const bad = /广告|微信|加我|代写/.test(content);
      const out = bad
        ? { verdict: 'rejected', category: '广告', reason: '含引流广告' }
        : { verdict: 'approved', category: '', reason: '就事论事' };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
    });
  });
  await new Promise((r) => mock.listen(0, '0.0.0.0', r));
  const port = mock.address().port;

  const cfg = await teacher.put('/api/teacher/ai-config', {
    api_base: `http://${AI_HOST}:${port}/v1`,
    api_key: 'sk-test-1234567890',
    model: 'mock-model',
  });
  eq('教师配置 AI', cfg.status, 200);
  const cfgView = (await teacher.get('/api/teacher/ai-config')).data;
  ok('回读时 key 脱敏', cfgView.own.keyMask === 'sk-****7890', cfgView.own.keyMask);
  ok('标记为已生效', cfgView.effective === true);

  // 一条正常评语
  const detail = (await author.get(`/api/student/activities/${scoreAct.id}`)).data;
  const scores = [];
  for (const t of detail.targets) for (const it of detail.items) scores.push({ targetId: t.id, itemId: it.id, score: 9 });
  await author.post(`/api/student/activities/${scoreAct.id}/submit`, {
    scores,
    comment: '第二部分的节奏控制得很好，收尾稍微仓促',
    commentTargetId: detail.targets[0].id,
  });

  let approved = null;
  for (let i = 0; i < 40; i++) {
    const list = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments`)).data.comments;
    approved = list.find((c) => c.content.includes('节奏控制得很好'));
    if (approved && approved.moderation_status !== 'pending') break;
    await sleep(150);
  }
  eq('AI 自动放行正常评语', approved?.moderation_status, 'approved');

  // 一条广告
  await author.post(`/api/student/activities/${scoreAct.id}/submit`, {
    scores,
    comment: '加我微信代写作业，价格便宜',
    commentTargetId: detail.targets[0].id,
  });
  let rejected = null;
  for (let i = 0; i < 40; i++) {
    const list = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments`)).data.comments;
    rejected = list.find((c) => c.content.includes('微信'));
    if (rejected && rejected.moderation_status !== 'pending') break;
    await sleep(150);
  }
  eq('AI 判定广告为驳回', rejected?.moderation_status, 'rejected');
  eq('带违规类别', rejected?.ai_category, '广告');

  // 超时 → 保持 pending
  await teacher.put('/api/teacher/ai-config', {
    api_base: `http://${AI_HOST}:${port}/slow/v1`,
    api_key: 'sk-test-1234567890',
    model: 'mock-model',
  });
  await author.post(`/api/student/activities/${scoreAct.id}/submit`, {
    scores,
    comment: '这条应该超时，停在待审',
    commentTargetId: detail.targets[0].id,
  });
  let timeoutComment = null;
  for (let i = 0; i < 60; i++) {
    const list = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments`)).data.comments;
    timeoutComment = list.find((c) => c.content.includes('超时'));
    if (timeoutComment && calls.length > 2) break;
    await sleep(500);
  }
  // 等 8 秒超时生效
  await sleep(9000);
  const listFinal = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments`)).data.comments;
  const timedOut = listFinal.find((c) => c.content.includes('超时'));
  eq('AI 超时后评语停在待审（不阻塞提交）', timedOut?.moderation_status, 'pending');

  // 断开 AI（清空配置）→ 新评语直接 pending
  await teacher.put('/api/teacher/ai-config', {});
  await author.post(`/api/student/activities/${scoreAct.id}/submit`, {
    scores,
    comment: '没配置 AI 时应该直接进待审',
    commentTargetId: detail.targets[0].id,
  });
  await sleep(600);
  const noAi = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/comments`)).data.comments.find((c) => c.content.includes('没配置'));
  eq('未配置 AI 时进入待审', noAi?.moderation_status, 'pending');

  mock.close();
}

/* ================= 7. 热词云 ================= */
console.log('\n[7] 热词');
{
  const words = (await teacher.get(`/api/teacher/activities/${scoreAct.id}/words`)).data.words;
  ok('返回热词数组', Array.isArray(words), words);
  ok('热词带频次且降序', words.length === 0 || words.every((w, i) => i === 0 || words[i - 1].count >= w.count), words.slice(0, 5));
}


/* ================= 8. 评分项模板 ================= */

console.log('\n[8] 评分项模板 / 复用');
{
  const r0 = await teacher.get('/api/teacher/rubrics');
  eq('模板接口可用', r0.status, 200);
  ok('最近活动里能带出评分项', r0.data.recent.length >= 1, r0.data.recent.length);

  const save = await teacher.post('/api/teacher/rubrics', {
    name: '冒烟模板',
    items: [
      { name: '完成度', min: 1, max: 10, weight: 60 },
      { name: '美观度', min: 1, max: 10, weight: 40 },
    ],
  });
  eq('存为模板', save.status, 200);

  const again = await teacher.post('/api/teacher/rubrics', {
    name: '冒烟模板',
    items: [{ name: '只改了一项', min: 0, max: 5, weight: 1 }],
  });
  ok('同名模板是覆盖而不是新增', !!again.data.updated, again.data);

  const list = (await teacher.get('/api/teacher/rubrics')).data.templates;
  const tpl = list.find((t) => t.name === '冒烟模板');
  ok('列表里只有一条「冒烟模板」', list.filter((t) => t.name === '冒烟模板').length === 1);
  eq('覆盖后是新的一套', tpl.items.length, 1);

  eq('记录使用次数', (await teacher.post(`/api/teacher/rubrics/${tpl.id}/use`)).status, 200);
  eq('空评分项被拒', (await teacher.post('/api/teacher/rubrics', { name: '坏模板', items: [] })).status, 400);
  eq('删除模板', (await teacher.delete(`/api/teacher/rubrics/${tpl.id}`)).status, 200);
  const after = (await teacher.get('/api/teacher/rubrics')).data.templates;
  ok('删除后列表里没有', !after.some((t) => t.id === tpl.id));
}


/* ================= 9. 管理员：学生总览 / 改用户名 / 重置密码 ================= */

console.log('\n[9] 管理员功能');
{
  const admin = client();
  eq('超管登录', (await admin.post('/api/auth/login', { username: 'admin', password: 'admin6666' })).status, 200);

  const list = await admin.get('/api/admin/students');
  eq('学生总览可用', list.status, 200);
  ok('学生列表非空', list.data.students.length >= 8, list.data.students.length);
  const first = list.data.students[0];
  ok('带出所属组和教师', 'groups_text' in first && 'teachers_text' in first, first);
  ok('能按姓名搜索', (await admin.get('/api/admin/students?q=张三')).data.students.length === 1);

  // 改用户名：建一个临时教师走一遍完整流程
  const t = await admin.post('/api/admin/teachers', { username: 'tmpusr', display_name: '临时老师', password: 'tmp123456' });
  eq('建临时教师', t.status, 200);
  const tmp = client();
  eq('用原账号登录', (await tmp.post('/api/auth/login', { username: 'tmpusr', password: 'tmp123456' })).status, 200);
  const badPwd = await tmp.post('/api/auth/change-username', { password: 'wrong', newUsername: 'tmpusr2' });
  eq('改用户名要密码确认', badPwd.status, 400);
  const dup = await tmp.post('/api/auth/change-username', { password: 'tmp123456', newUsername: 'teacher1' });
  eq('不能改成已占用的账号', dup.status, 400);
  const badName = await tmp.post('/api/auth/change-username', { password: 'tmp123456', newUsername: 'a b' });
  eq('非法账号被拒', badName.status, 400);
  const okName = await tmp.post('/api/auth/change-username', { password: 'tmp123456', newUsername: 'tmpusr2' });
  eq('改用户名成功', okName.status, 200);
  ok('旧账号登不上了', (await client().post('/api/auth/login', { username: 'tmpusr', password: 'tmp123456' })).status === 401);
  eq('新账号能登', (await client().post('/api/auth/login', { username: 'tmpusr2', password: 'tmp123456' })).status, 200);

  // 重置学生密码（2023008 没被其它用例占用）
  const sid = list.data.students.find((s) => s.username === '2023008')?.id;
  ok('找得到学生 2023008', !!sid);
  eq('重置学生密码', (await admin.post(`/api/admin/students/${sid}/reset-password`, {})).status, 200);
  const relogin = await client().post('/api/auth/login', { username: '2023008', password: '2023008' });
  eq('重置后能用学号登录', relogin.status, 200);
  ok('并要求改密码', !!relogin.data.must_change_pwd, relogin.data);

  eq('学生接口不对外', (await teacher.get('/api/admin/students')).status, 403);
}

console.log('\n' + '='.repeat(48));
if (failures.length === 0) {
  console.log(`P1 冒烟全部通过：${passed} 项`);
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
