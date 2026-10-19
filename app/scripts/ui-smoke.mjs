/**
 * 界面级冒烟：用 jsdom 真渲染生产打包产物（dist/web），走一遍登录 → 教师看结果 → 学生首次改密 → 学生未参与。
 * 需要：一个已灌演示数据的实例（跑过 scripts/seed.mjs）。
 * 用法：BASE=http://127.0.0.1:3990 node scripts/ui-smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const BASE = process.env.BASE || 'http://127.0.0.1:3990';
const APP_DIR = path.resolve(import.meta.dirname, '..');

let passed = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${extra !== undefined ? '\n      ' + JSON.stringify(extra).slice(0, 400) : ''}`);
  }
}

/* ---------- 把 jsdom 装成全局环境，再加载打包好的前端 ---------- */

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: BASE + '/',
  pretendToBeVisual: true,
});
const W = dom.window;

for (const key of [
  'window',
  'document',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'CustomEvent',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  try {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? W : W[key], configurable: true, writable: true });
  } catch {
    /* 某些键在 Node 里是只读的，忽略 */
  }
}
try {
  Object.defineProperty(globalThis, 'navigator', { value: W.navigator, configurable: true });
} catch {
  /* ignore */
}

const nodeFetch = globalThis.fetch.bind(globalThis);
let cookie = '';
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' && input.startsWith('http') ? input : BASE + String(input);
  const headers = new Headers(init.headers || {});
  if (cookie) headers.set('cookie', cookie);
  const res = await nodeFetch(url, { method: init.method || 'GET', headers, body: init.body });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(/^sid=([^;]*)/);
    if (m) cookie = m[1] ? `sid=${m[1]}` : '';
  }
  return res;
};

const assetsDir = path.join(APP_DIR, 'dist/web/assets');
const bundle = fs.readdirSync(assetsDir).find((f) => f.endsWith('.js'));
if (!bundle) {
  console.error('没找到前端产物，先 pnpm build');
  process.exit(1);
}

const errors = [];
W.addEventListener('error', (e) => errors.push(String(e.message)));
W.onerror = (msg) => errors.push(String(msg));
const origError = console.error;
console.error = (...args) => {
  errors.push(args.map(String).join(' '));
  origError(...args);
};

console.log('\n[0] 加载生产打包产物');
try {
  await import(`file://${path.join(assetsDir, bundle)}`);
  ok('前端入口执行成功', true);
} catch (e) {
  ok('前端入口执行成功', false, e.message);
  console.log(e);
  process.exit(1);
}

/* ---------- 工具 ---------- */

const text = () => W.document.body.textContent || '';
const byText = (sel, needle) =>
  [...W.document.querySelectorAll(sel)].find((el) => (el.textContent || '').includes(needle));

async function waitFor(fn, label, timeout = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const v = fn();
      if (v) return v;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`超时等待：${label}\n当前页面文字：${text().slice(0, 300)}`);
}

function setValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new W.Event('input', { bubbles: true }));
  el.dispatchEvent(new W.Event('change', { bubbles: true }));
}

function click(el) {
  el.dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true }));
}

/* ---------- 1. 登录页 ---------- */

console.log('\n[1] 登录页');
await waitFor(() => text().includes('账号 / 学号'), '登录表单');
ok('渲染出登录表单', text().includes('课堂互评'));
ok('有账号输入框', W.document.querySelectorAll('input').length >= 2);

/* ---------- 2. 教师登录 ---------- */

console.log('\n[2] 教师登录 → 评价项列表');
const inputs = () => [...W.document.querySelectorAll('input')];
setValue(inputs()[0], 'teacher1');
setValue(inputs()[1], 'teach123');
click(byText('button', '登录'));
await waitFor(() => text().includes('作品互评'), '教师活动列表');
ok('登录后进入教师端', text().includes('王老师'));
ok('能看到评价项', text().includes('作品互评 · 3月作业') && text().includes('最受欢迎的作品'));
ok('显示参与进度', /已交\s*5\s*\/\s*8/.test(text()), text().match(/已交[^·]*/)?.[0]);
ok('显示深色/浅色卡片状态', text().includes('进行中'));

/* ---------- 3. 教师看结果（去极值明细） ---------- */

console.log('\n[3] 实时结果页');
// 列表按新→旧排，投票在前；这里要进「评分」那个
const scoreCard = [...W.document.querySelectorAll('.card')].find((c) => (c.textContent || '').includes('作品互评 · 3月作业'));
ok('找到评分活动的卡片', !!scoreCard);
const scoreBtn = [...scoreCard.querySelectorAll('button')].find((b) => (b.textContent || '').includes('结果'));
click(scoreBtn);
await waitFor(() => text().includes('去极值说明'), '结果页');
ok('结果页打开', text().includes('作品A'));
ok('显示去极值规则说明', text().includes('两端各去掉'));
ok('显示加权总分', text().includes('加权总分'));
ok('显示有效人数', /人数 n/.test(text()));
click(byText('a', '未交'));
await waitFor(() => text().includes('还没交的人'), '未交名单页');
ok('显示未交名单', text().includes('还没交的人') && text().includes('王五'));
ok('有入场二维码按钮', !!byText('button', '入场二维码'));

click(byText('button', '入场二维码'));
await waitFor(() => text().includes('扫码入场'), '二维码面板');
const qrImg = [...W.document.querySelectorAll('img')].find((i) => (i.getAttribute('src') || '').includes('/api/qr'));
ok('二维码图片已渲染', !!qrImg, qrImg?.getAttribute('src')?.slice(0, 40));

/* ---------- 4. 退出 → 学生首次登录 ---------- */

console.log('\n[4] 学生首次登录（强制改密）');
click(byText('button', '退出'));
await waitFor(() => text().includes('账号 / 学号'), '回到登录页');

// 演示数据里还有 3 个没登录过的学生；脚本可能被重复跑，逐个试
const CANDIDATES = ['2023003', '2023007', '2023008', '2023004', '2023006'];
let student = null;
for (const u of CANDIDATES) {
  setValue(inputs()[0], u);
  setValue(inputs()[1], u);
  click(byText('button', '登录'));
  await new Promise((r) => setTimeout(r, 500));
  if (text().includes('首次登录，请修改初始密码')) {
    student = u;
    break;
  }
  if (text().includes('已提交过') || text().includes('我的积分')) {
    // 这个学生已经进来过（密码被改过），退出换下一个
    click(byText('button', '退出'));
    await waitFor(() => text().includes('账号 / 学号'), '回到登录页');
  }
}
ok('找到一个还没登录过的学生', !!student, CANDIDATES);
if (!student) {
  console.log('  （这个实例的学生都被登过了，用 pnpm seed 重建一个干净实例再跑）');
  process.exit(1);
}
await waitFor(() => text().includes('首次登录，请修改初始密码'), '强制改密页');
ok('首次登录被要求改密', text().includes('首次登录，请修改初始密码'));

const pwdInputs = [...W.document.querySelectorAll('input[type="password"]')];
ok('有 3 个密码输入框', pwdInputs.length === 3, pwdInputs.length);
setValue(pwdInputs[0], student);
setValue(pwdInputs[1], 'newpass123');
setValue(pwdInputs[2], 'newpass123');
click(byText('button', '确认修改'));
await waitFor(() => text().includes('我的积分') || text().includes('还没有'), '学生首页');
ok('改密后进入学生首页', true);

/* ---------- 5. 学生首页：深蓝未参与卡 ---------- */

console.log('\n[5] 学生首页（未参与状态）');
// 活动列表是异步拉的，先等它渲染出来
await waitFor(() => text().includes('点这里去参与'), '学生活动卡片');
ok('显示我的积分', text().includes('我的积分'));
ok('显示评分活动', text().includes('作品互评 · 3月作业'));
const todoCards = W.document.querySelectorAll('.act.todo');
ok('未参与的活动是深蓝卡（act todo）', todoCards.length >= 1, todoCards.length);
ok('卡片提示去参与', text().includes('点这里去参与'));
// 投票和评分都未参与，按新→旧排；这里点「评分」那个
const todoScore = [...todoCards].find((c) => (c.textContent || '').includes('作品互评'));

/* ---------- 6. 打开评分页（滑块 + 打满校验） ---------- */

console.log('\n[6] 评分填写页');
click(todoScore);
await waitFor(() => text().includes('已填'), '评分页');
ok('打开评分页', text().includes('作品A'));
// 若这个学生自己就是某个被评对象的作者，他少评一个（不评自己）
const owner = ['2023001', '2023002', '2023003'].includes(student);
const expectSliders = owner ? 6 : 9;
ok(`应评 ${expectSliders} 格（${owner ? '本人在被评对象里，少评一个' : '3 对象 × 3 项'}）`, /已填\s*0\s*\/\s*\d+/.test(text()), text().match(/已填[^格]*/)?.[0]);
const sliders = W.document.querySelectorAll('input[type="range"]');
ok(`渲染出 ${expectSliders} 个滑块`, sliders.length === expectSliders, sliders.length);
const submitBtn = () => [...W.document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('还差') || (b.textContent || '').includes('提交评分'));
ok('未打满时提交按钮提示还差格数', (submitBtn()?.textContent || '').includes('还差'), submitBtn()?.textContent);
ok('未打满时提交按钮禁用', submitBtn()?.disabled === true);

console.log('\n[6b] 拖动全部滑块 → 提交评分');
for (const el of sliders) {
  Object.getOwnPropertyDescriptor(W.HTMLInputElement.prototype, 'value').set.call(el, '8');
  el.dispatchEvent(new W.Event('input', { bubbles: true }));
  el.dispatchEvent(new W.Event('change', { bubbles: true }));
}
await waitFor(() => submitBtn()?.disabled === false, '提交按钮变可用');
ok('打满后提交按钮可用', submitBtn()?.disabled === false);
ok('打满后按钮文案变成「提交评分」', (submitBtn()?.textContent || '').includes('提交评分'), submitBtn()?.textContent);
click(submitBtn());
await waitFor(() => text().includes('各作品得分'), '结果页');
ok('提交后跳到结果页', text().includes('各作品得分'));
ok('结果页显示每个作品的分数', W.document.querySelectorAll('.bar-track').length >= 2);
ok('结果页列出各评分项均分', text().includes('完成度') && text().includes('美观度') && text().includes('创意'), text().slice(-160));

console.log('\n[6c] 返回首页 → 积分已加');
click(byText('button', '返回'));
await waitFor(() => text().includes('我的积分'), '学生首页');
await waitFor(() => text().includes('最受欢迎'), '学生活动列表刷新');
const pointsMatch = text().match(/我的积分(\d+)/);
ok('参与后积分 +10', pointsMatch?.[1] === '10', pointsMatch?.[0]);

console.log('\n[6d] 投票页 → 提交');
const todoVote = [...W.document.querySelectorAll('.act.todo')].find((c) => (c.textContent || '').includes('最受欢迎'));
ok('投票还未参与', !!todoVote);
click(todoVote);
await waitFor(() => text().includes('单选'), '投票页');
const radios = W.document.querySelectorAll('input[type="radio"]');
ok('渲染出 3 个单选项', radios.length === 3, radios.length);
click(radios[0]);
await waitFor(() => {
  const b = [...W.document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('提交投票'));
  return b && b.disabled === false;
}, '投票按钮可用');
const voteBtn = [...W.document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('提交投票'));
click(voteBtn);
await waitFor(() => text().includes('实时票数'), '投票结果页');
ok('投票提交后看到实时票数', text().includes('实时票数'));
ok('最高票有 👑 标记', text().includes('当前最高'));

/* ---------- 7. 收尾 ---------- */

console.log('\n[7] 运行期错误');
const realErrors = errors.filter(
  (e) => !/Not implemented: HTMLCanvasElement|css|Warning: Each child|act\(/.test(e) && !e.includes('Could not parse CSS'),
);
ok('没有渲染期 JS 报错', realErrors.length === 0, realErrors.slice(0, 3));

console.log('\n' + '='.repeat(48));
if (failures.length === 0) {
  console.log(`界面冒烟全部通过：${passed} 项`);
  process.exit(0);
} else {
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
