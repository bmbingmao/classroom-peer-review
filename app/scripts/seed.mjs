/**
 * 演示数据：建 1 个教师、1 个班 8 人、一次评分 + 一次投票，其中 5 人已提交。
 * 用法（先起一个干净的实例）：
 *   BASE=http://127.0.0.1:3000 node scripts/seed.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3000';

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
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
}

const NAMES = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十'];

async function main() {
  // 1. 超管
  const admin = client();
  await admin('POST', '/api/auth/login', { username: 'admin', password: 'admin12345' });
  await admin('POST', '/api/auth/change-password', { oldPassword: 'admin12345', newPassword: 'admin6666' });
  console.log('✓ 超管就绪 admin / admin6666');

  await admin('POST', '/api/admin/teachers', { username: 'teacher1', display_name: '王老师', password: 'teach123' });
  console.log('✓ 教师：teacher1 / teach123（王老师）');

  // 2. 教师建组导学生
  const t = client();
  await t('POST', '/api/auth/login', { username: 'teacher1', password: 'teach123' });
  const g = await t('POST', '/api/teacher/groups', { name: '计算机1班' });
  const text = NAMES.map((n, i) => `20230${String(i + 1).padStart(2, '0')},${n}`).join('\n');
  const imp = await t('POST', `/api/teacher/groups/${g.id}/import`, { text });
  console.log(`✓ 班级「计算机1班」导入 ${imp.added} 人（学号 2023001~2023008，初始密码=学号）`);

  const members = (await t('GET', `/api/teacher/groups/${g.id}/members`)).members;
  const students = NAMES.map((n, i) => ({
    username: `20230${String(i + 1).padStart(2, '0')}`,
    name: n,
    id: members.find((m) => m.username === `20230${String(i + 1).padStart(2, '0')}`)?.id,
  }));

  // 3. 评分活动
  const score = await t('POST', '/api/teacher/activities', {
    type: 'score',
    title: '作品互评 · 3月作业',
    description: '按完成度和美观度打分，注意看作品细节。',
    anonymous: true,
    startAt: Date.now() - 60_000,
    endAt: Date.now() + 3 * 3600_000,
    groupIds: [g.id],
    items: [
      { name: '完成度', min: 1, max: 10, weight: 50 },
      { name: '美观度', min: 1, max: 10, weight: 30 },
      { name: '创意', min: 1, max: 10, weight: 20 },
    ],
    targets: [
      { anonLabel: '作品A', studentId: students[0].id },
      { anonLabel: '作品B', studentId: students[1].id },
      { anonLabel: '作品C', studentId: students[2].id },
    ],
  });
  console.log(`✓ 评分活动 #${score.id}「作品互评 · 3月作业」（3 项 rubric，3 个被评对象）`);

  // 4. 前 5 个学生改密并提交
  const submitters = [0, 1, 3, 4, 5];
  for (const idx of submitters) {
    const s = students[idx];
    const c = client();
    await c('POST', '/api/auth/login', { username: s.username, password: s.username });
    await c('POST', '/api/auth/change-password', { oldPassword: s.username, newPassword: `pw${s.username}` });
    const d = await c('GET', `/api/student/activities/${score.id}`);
    const arr = [];
    for (const tg of d.targets) {
      for (const it of d.items) {
        // 造一点分散度：第一个对象整体偏高，第二个中等，第三个偏低
        const base = tg.anon_label === '作品A' ? 9 : tg.anon_label === '作品B' ? 7 : 6;
        const jitter = ((idx * 7 + tg.id * 3 + it.id * 5) % 3) - 1;
        arr.push({ targetId: tg.id, itemId: it.id, score: Math.min(10, Math.max(1, base + jitter)) });
      }
    }
    await c('POST', `/api/student/activities/${score.id}/submit`, { scores: arr });
  }
  console.log(`✓ ${submitters.length} 人已提交评分（密码已改为 pw+学号，例如 pw2023001）`);

  // 5. 投票
  const vote = await t('POST', '/api/teacher/activities', {
    type: 'vote',
    title: '最受欢迎的作品',
    anonymous: true,
    startAt: Date.now() - 60_000,
    endAt: Date.now() + 3 * 3600_000,
    groupIds: [g.id],
    options: [{ text: '作品A' }, { text: '作品B' }, { text: '作品C' }],
    multiple: false,
  });
  const vd = await t(`GET`, `/api/teacher/activities/${vote.id}`);
  const optIds = vd.options.map((o) => o.id);
  const votes = [0, 0, 0, 1, 2];
  for (let k = 0; k < submitters.length; k++) {
    const s = students[submitters[k]];
    const c = client();
    await c('POST', '/api/auth/login', { username: s.username, password: `pw${s.username}` });
    await c('POST', `/api/student/activities/${vote.id}/vote`, { optionIds: [optIds[votes[k]]] });
  }
  console.log(`✓ 投票活动 #${vote.id}「最受欢迎的作品」（5 人已投）`);

  const left = students.filter((_, i) => !submitters.includes(i)).map((s) => s.username);
  console.log('');
  console.log('演示入口：');
  console.log(`  学生（还没参与，会先要求改密）：${left.join(' / ')}，密码=学号`);
  console.log('  学生（已提交）：账号 2023001，密码 pw2023001（改过的都是 pw + 学号）');
  console.log('  教师：teacher1 / teach123');
  console.log('  超管：admin / admin6666');
}

main().catch((e) => {
  console.error('种子数据失败：', e.message);
  process.exit(1);
});
