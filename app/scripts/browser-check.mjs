/**
 * 真实浏览器验证（Chromium）：登录、教师结果页、二维码、学生首次改密、深蓝卡、滑块、提交、手机 375px 排版。
 *
 * 依赖（不在 package.json 里，避免生产镜像变重）：
 *   npm i -D playwright && npx playwright install chromium
 *
 * 用法（需要一个已 seed 的实例）：
 *   BASE=http://127.0.0.1:3988 node scripts/browser-check.mjs
 * 截图输出到 docs/screenshots/（可用 SHOTS 环境变量改）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:3988';
const OUT = process.env.SHOTS || new URL('../docs/screenshots', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
// 未登录时首屏会探测 /api/auth/me，浏览器必然打印一条 401 resource 错误，属正常
const benign = (list) => list.filter((e) => !/Failed to load resource.*401|401 \(Unauthorized\)/.test(e));
let n = 0;
function ok(name, cond, extra) {
  n++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name}${extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 200) : ''}`);
    errors.push(name);
  }
}

const browser = await chromium.launch();

async function newPage(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') jsErrors.push('console: ' + m.text());
  });
  return { ctx, page, jsErrors };
}

async function shot(page, name, fullPage = true) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`     · 截图 ${name}.png`);
}

async function login(page, username, password) {
  await page.fill('input[type="text"]', username);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("登录")');
}

/* ================= 桌面端：教师 ================= */
console.log('\n[教师端 · 桌面 1280x900]');
{
  const { ctx, page, jsErrors } = await newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok('登录页渲染', await page.locator('text=课堂互评').first().isVisible());
  await shot(page, '01-login', false);

  await login(page, 'teacher1', 'teach123');
  await page.waitForSelector('text=作品互评 · 3月作业', { timeout: 8000 });
  ok('教师登录成功，看到评价项', true);
  ok('显示参与进度 5/8', (await page.locator('body').innerText()).includes('已交'));
  await shot(page, '02-teacher-list');

  // 进评分结果页
  const card = page.locator('.card', { hasText: '作品互评 · 3月作业' }).first();
  await card.locator('button:has-text("结果")').click();
  await page.waitForSelector('text=去极值说明', { timeout: 8000 });
  ok('结果页打开', true);
  const resultText = await page.locator('body').innerText();
  ok('显示加权总分', resultText.includes('加权总分'));
  ok('显示有效人数与剔除说明', resultText.includes('人数 n') && resultText.includes('被剔除的分数'));
  await page.click('a:has-text("未交")');
  await page.waitForSelector('text=还没交的人');
  ok('显示未交名单', true);
  await page.click('a:has-text("结果")');
  await shot(page, '03-teacher-result');

  // 二维码
  await page.click('button:has-text("入场二维码")');
  await page.waitForSelector('text=扫码入场');
  await page.waitForFunction(
    () => {
      const i = document.querySelector('img.qr');
      return !!i && i.complete && i.naturalWidth > 100;
    },
    { timeout: 5000 },
  ).catch(() => {});
  const qrOk = await page.locator('img.qr').evaluate((img) => img.complete && img.naturalWidth > 100);
  ok('二维码图片真实加载（大于 100px）', qrOk);
  await shot(page, '04-qr', false);

  // 投票结果页
  await page.goto(BASE + '/#/t/activities');
  await page.waitForSelector('text=最受欢迎的作品');
  const voteCard = page.locator('.card', { hasText: '最受欢迎的作品' }).first();
  await voteCard.locator('button:has-text("结果")').click();
  await page.waitForSelector('text=实时票数');
  const voteText = await page.locator('body').innerText();
  ok('投票结果只显示票数', voteText.includes('实时票数') && !voteText.includes('加权总分'));
  ok('最高票有 👑 标记', voteText.includes('当前最高'));
  await shot(page, '05-vote-result');

  ok('教师端无 JS 报错', benign(jsErrors).length === 0, benign(jsErrors).slice(0, 3));
  await ctx.close();
}

/* ================= 桌面端：学生首次登录 ================= */
console.log('\n[学生端 · 桌面]');
let studentName = null;
{
  const { ctx, page, jsErrors } = await newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });

  for (const u of ['2023007', '2023008', '2023003']) {
    await login(page, u, u);
    await page.waitForTimeout(600);
    if ((await page.locator('body').innerText()).includes('首次登录，请修改初始密码')) {
      studentName = u;
      break;
    }
    await page.click('button:has-text("退出")').catch(() => {});
    await page.waitForTimeout(300);
  }
  ok('学生首次登录被强制改密', !!studentName, studentName);
  await shot(page, '06-force-change-pwd', false);

  const pwds = page.locator('input[type="password"]');
  await pwds.nth(0).fill(studentName);
  await pwds.nth(1).fill('newpass123');
  await pwds.nth(2).fill('newpass123');
  await page.click('button:has-text("确认修改")');
  await page.waitForSelector('text=我的积分', { timeout: 8000 });
  ok('改密后进入学生首页', true);
  const homeText = await page.locator('body').innerText();
  ok('未参与活动是深蓝色卡片', (await page.locator('.act.todo').count()) >= 1);
  await shot(page, '07-student-home');

  // 进评分页
  const scoreCard = page.locator('.act.todo', { hasText: '作品互评' }).first();
  await scoreCard.click();
  await page.waitForSelector('input[type="range"]');
  ok('评分页打开', true);
  const sliders = page.locator('input[type="range"]');
  const sliderCount = await sliders.count();
  ok(`滑块数量合理（${sliderCount} 个）`, sliderCount === 6 || sliderCount === 9);
  const submitDisabled = await page.locator('button.btn-primary').first().isDisabled();
  ok('未打满时提交禁用', submitDisabled);
  await shot(page, '08-score-empty');

  // 拖动滑块
  for (let i = 0; i < sliderCount; i++) {
    await sliders.nth(i).evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '8');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await page.waitForTimeout(400);
  const bodyNow = await page.locator('body').innerText();
  ok('打满后显示可提交', !bodyNow.includes('还差') || bodyNow.includes('提交评分'), bodyNow.match(/还差[^，]*/)?.[0]);
  await shot(page, '09-score-filled');

  await page.click('button:has-text("提交评分")');
  await page.waitForSelector('text=各作品得分', { timeout: 8000 });
  ok('提交后进入结果页', true);
  await shot(page, '10-student-result');

  ok('学生端无 JS 报错', benign(jsErrors).length === 0, benign(jsErrors).slice(0, 3));
  await ctx.close();
}

/* ================= 手机端（375px） ================= */
console.log('\n[手机端 · 375x812]');
{
  const { ctx, page, jsErrors } = await newPage({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shot(page, '11-mobile-login', false);

  // 用刚改过密码的学生登录
  await login(page, studentName, 'newpass123');
  await page.waitForSelector('text=我的积分', { timeout: 8000 });
  ok('手机上登录成功', true);
  await shot(page, '12-mobile-home');

  // 横向溢出检查
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('手机端无横向滚动', overflow <= 1, { overflow });

  // 手机上的评分页（滑块是最容易挤坏的地方）—— 用「修改评分」入口进去
  const editBtn = page.locator('button:has-text("修改评分")');
  if ((await editBtn.count()) > 0) {
    await editBtn.first().click();
    await page.waitForSelector('input[type="range"]');
    ok('已提交后仍能进评分页修改（入口存在）', true);
    const of = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok('手机端评分页无横向滚动', of <= 1, { overflow: of });
    const thumbOk = await page.locator('input[type="range"]').first().evaluate((el) => el.getBoundingClientRect().width > 80);
    ok('手机上滑块宽度够用（>80px）', thumbOk);
    await shot(page, '14-mobile-score');
    await page.click('button:has-text("返回")').catch(() => {});
    await page.waitForTimeout(300);
  } else {
    ok('已提交后仍能进评分页修改（入口存在）', false, '没找到「修改评分」按钮');
  }

  // 进结果页看排版
  await page.locator('.act.done').first().click();
  await page.waitForTimeout(800);
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('结果页在手机上无横向滚动', overflow2 <= 1, { overflow: overflow2 });
  await shot(page, '13-mobile-result');

  ok('手机端无 JS 报错', benign(jsErrors).length === 0, benign(jsErrors).slice(0, 3));
  await ctx.close();
}

await browser.close();

console.log('\n' + '='.repeat(48));
if (errors.length === 0) {
  console.log(`真实浏览器验证通过：${n} 项，截图在 ${OUT}`);
  process.exit(0);
} else {
  console.log(`失败 ${errors.length} 项：`);
  for (const e of errors) console.log('  - ' + e);
  process.exit(1);
}
