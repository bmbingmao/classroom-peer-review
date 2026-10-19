/**
 * P1 真实浏览器验证：评语墙、待审放行、小眼睛、图表、表情互动、积分页、Excel 导出。
 * 依赖：npm i -D playwright && npx playwright install chromium
 * 用法：BASE=http://127.0.0.1:3985 node scripts/browser-check-p1.mjs
 * 需要一个已跑过 seed.mjs 的干净实例。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:3985';
const OUT = process.env.SHOTS || '/tmp/pw/shots-p1';
fs.mkdirSync(OUT, { recursive: true });

let n = 0;
const failures = [];
function ok(name, cond, extra) {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.log(`  ✗ ${name}${extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 300) : ''}`);
  }
}
const benign = (list) => list.filter((e) => !/Failed to load resource.*401|401 \(Unauthorized\)/.test(e));

const browser = await chromium.launch();

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  page.on('dialog', (d) => d.accept());
  return { ctx, page, errors };
}

async function login(page, u, p) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', u);
  await page.fill('input[type="password"]', p);
  await page.click('button:has-text("登录")');
  await page.waitForTimeout(700);
}

async function shot(page, name, full = true) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log(`     · 截图 ${name}.png`);
}

/* ---------- 1. 学生写评语 ---------- */
console.log('\n[1] 学生提交带评语的评分');
let studentName = null;
{
  const { ctx, page, errors } = await newPage();
  for (const u of ['2023007', '2023008', '2023003']) {
    await login(page, u, u);
    if ((await page.locator('body').innerText()).includes('首次登录，请修改初始密码')) {
      studentName = u;
      break;
    }
  }
  ok('学生首次登录强制改密', !!studentName, studentName);
  const pwds = page.locator('input[type="password"]');
  await pwds.nth(0).fill(studentName);
  await pwds.nth(1).fill('newpass123');
  await pwds.nth(2).fill('newpass123');
  await page.click('button:has-text("确认修改")');
  await page.waitForSelector('text=我的积分');

  await page.locator('.act.todo', { hasText: '作品互评' }).first().click();
  await page.waitForSelector('input[type="range"]');

  const sliders = page.locator('input[type="range"]');
  const count = await sliders.count();
  for (let i = 0; i < count; i++) {
    await sliders.nth(i).evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '8');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  const boxes = page.locator('textarea');
  ok('每个被评对象都有评语框', (await boxes.count()) === 3, await boxes.count());
  await boxes.first().fill('配色很舒服，第三幕构图有点空');
  await page.waitForTimeout(300);
  await shot(page, 'p1-01-score-with-comment');

  await page.click('button:has-text("提交评分")');
  await page.waitForSelector('text=各作品得分');
  ok('提交后到结果页', true);
  const wallText = await page.locator('body').innerText();
  ok('未审核的评语不出现在墙上', wallText.includes('评语还在审核中'), wallText.slice(-200));
  ok('学生端无 JS 报错', benign(errors).length === 0, benign(errors).slice(0, 2));
  await ctx.close();
}

/* ---------- 2. 教师审核 + 小眼睛 + 图表 + 导出 ---------- */
console.log('\n[2] 教师端：待审、小眼睛、图表、导出');
{
  const { ctx, page, errors } = await newPage();
  await login(page, 'teacher1', 'teach123');
  await page.waitForSelector('text=作品互评 · 3月作业');

  const card = page.locator('.card', { hasText: '作品互评 · 3月作业' }).first();
  await card.locator('button:has-text("结果")').click();
  await page.waitForSelector('text=去极值说明');

  // 待审提示
  ok('顶部出现待审提醒', (await page.locator('text=条评语待你审核').count()) > 0);
  await page.click('a:has-text("评语")');
  await page.waitForSelector('text=待审（1）');
  ok('评语页看到待审 1 条', true);
  await shot(page, 'p1-02-teacher-pending');

  // 放行
  await page.click('button:has-text("放行")');
  await page.waitForTimeout(800);
  const commentText = await page.locator('body').innerText();
  ok('放行后进入已通过', commentText.includes('已通过（1）'), commentText.includes('已通过（'));

  // 小眼睛
  await page.click('button:has-text("显示真实身份")');
  await page.waitForTimeout(600);
  const afterEye = await page.locator('body').innerText();
  ok('小眼睛后显示真实身份', afterEye.includes('显示真实身份') === false || afterEye.includes('隐藏身份'));
  await page.click('a:has-text("结果")');
  await page.waitForTimeout(500);
  const resultText = await page.locator('body').innerText();
  ok('结果页出现真实姓名（小眼睛打开时）', /实际：张三|实际：李四|实际：王五/.test(resultText), resultText.slice(0, 200));
  await shot(page, 'p1-03-identity-on');

  // 图表
  await page.click('a:has-text("图表")');
  await page.waitForSelector('text=各作品在单项上的对比');
  const svgs = await page.locator('svg').count();
  ok('柱状图与雷达图都画出来了', svgs >= 2, svgs);
  await shot(page, 'p1-04-charts');

  // 导出
  await page.click('a:has-text("结果")');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    page.click('button:has-text("导出 Excel")'),
  ]);
  ok('点击导出触发下载', !!download, download ? download.suggestedFilename() : 'no download');
  if (download) {
    const path = await download.path();
    const size = fs.statSync(path).size;
    ok('下载文件是 xlsx 且不为空', size > 5000, size);
  }

  ok('教师端无 JS 报错', benign(errors).length === 0, benign(errors).slice(0, 2));
  await ctx.close();
}

/* ---------- 3. 表情互动 ---------- */
console.log('\n[3] 另一个学生发 👍');
{
  const { ctx, page, errors } = await newPage();
  let u = null;
  for (const cand of ['2023008', '2023003']) {
    await login(page, cand, cand);
    if ((await page.locator('body').innerText()).includes('首次登录，请修改初始密码')) {
      u = cand;
      break;
    }
  }
  ok('找到第二个未登录学生', !!u, u);
  const pwds = page.locator('input[type="password"]');
  await pwds.nth(0).fill(u);
  await pwds.nth(1).fill('newpass123');
  await pwds.nth(2).fill('newpass123');
  await page.click('button:has-text("确认修改")');
  await page.waitForSelector('text=我的积分');

  // 先投个票拿 10 分（发表情要先有积分）
  await page.locator('.act.todo', { hasText: '最受欢迎' }).first().click();
  await page.waitForSelector('input[type="radio"]');
  await page.locator('input[type="radio"]').first().click();
  await page.click('button:has-text("提交投票")');
  await page.waitForSelector('text=实时票数');
  ok('先参与投票拿到积分', true);

  await page.goto(BASE + '/#/s/result/1');
  await page.waitForSelector('text=评语墙', { timeout: 8000 });
  await page.waitForTimeout(800);
  const wall = await page.locator('body').innerText();
  ok('已通过的评语出现在墙上', wall.includes('配色很舒服'), wall.slice(-200));
  const likeBtn = page.locator('button:has-text("👍")').first();
  ok('评语下有表情按钮', (await likeBtn.count()) > 0);
  await likeBtn.click();
  await page.waitForTimeout(900);
  const after = await page.locator('body').innerText();
  ok('点赞后计数变成 1', /👍\s*1/.test(after), after.match(/👍[^\n]*/)?.[0]);
  await shot(page, 'p1-05-comment-wall');

  // 积分页
  await page.goto(BASE + '/#/s/points');
  await page.waitForSelector('text=班级排行榜');
  const pts = await page.locator('body').innerText();
  ok('积分页显示排行榜', pts.includes('班级排行榜') && pts.includes('流水'));
  await shot(page, 'p1-06-student-points');
  ok('学生端无 JS 报错', benign(errors).length === 0, benign(errors).slice(0, 2));
  await ctx.close();
}

/* ---------- 4. 手机端 ---------- */
console.log('\n[4] 手机端 375px');
{
  const { ctx, page, errors } = await newPage({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await login(page, 'teacher1', 'teach123');
  await page.waitForSelector('text=作品互评 · 3月作业');
  await page.goto(BASE + '/#/t/result/1');
  await page.waitForSelector('text=去极值说明');
  await page.click('a:has-text("评语")');
  await page.waitForTimeout(700);
  const of = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('手机端评语页无横向滚动', of <= 1, { overflow: of });
  await shot(page, 'p1-07-mobile-comments');
  ok('手机端无 JS 报错', benign(errors).length === 0, benign(errors).slice(0, 2));
  await ctx.close();
}

await browser.close();

console.log('\n' + '='.repeat(48));
if (failures.length === 0) {
  console.log(`P1 真实浏览器验证通过：${n} 项，截图在 ${OUT}`);
  process.exit(0);
} else {
  console.log(`失败 ${failures.length} 项：`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
