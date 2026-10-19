import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, one, run } from './db.ts';
import { attachUser, forceChangePwdGate, hashPwd, requireLogin, requireRole } from './auth.ts';

import authRoutes from './routes/auth.ts';
import adminRoutes from './routes/admin.ts';
import groupRoutes from './routes/groups.ts';
import activityRoutes from './routes/activities.ts';
import studentRoutes from './routes/student.ts';
import { studentRouter as studentResults, teacherRouter as teacherResults } from './routes/results.ts';
import miscRoutes from './routes/misc.ts';
import exportRoutes from './routes/export.ts';
import { studentComments, teacherComments } from './routes/comments.ts';
import { teacherPoints, studentPoints } from './routes/points.ts';
import { adminAi, teacherAi } from './routes/aiconfig.ts';
import { resumePending } from './ai-worker.ts';

const HERE = import.meta.dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const WEB_DIST = path.resolve(HERE, '../../dist/web');

bootstrapAdmin();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // 反向代理下读 X-Forwarded-Proto

app.use(cookieParser());
// 媒体上传走原始二进制，必须在 json 解析之前
app.use('/api/media', express.raw({ type: () => true, limit: '100mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);
app.use('/api', forceChangePwdGate);

/* ---------------- 路由 ---------------- */

app.use('/api/auth', authRoutes);

app.use('/api/admin', requireRole('admin'), adminRoutes);

// 教师侧：/api/teacher/*
app.use('/api/teacher', requireRole('teacher'), groupRoutes);
app.use('/api/teacher', requireRole('teacher'), activityRoutes);
app.use('/api/teacher', requireRole('teacher'), teacherResults);

// 学生侧：/api/student/*
app.use('/api/student', requireRole('student'), studentRoutes);
app.use('/api/student', requireRole('student'), studentResults);

// 通用（登录即可）
app.use('/api/teacher', requireRole('teacher'), teacherComments);
app.use('/api/teacher', requireRole('teacher'), teacherPoints);
app.use('/api/teacher', requireRole('teacher'), exportRoutes);
app.use('/api/teacher', requireRole('teacher'), teacherAi);
app.use('/api/student', requireRole('student'), studentComments);
app.use('/api/student', requireRole('student'), studentPoints);
app.use('/api/admin', requireRole('admin'), adminAi);

app.use('/api', requireLogin, miscRoutes);

/* ---------------- 静态资源（前端构建产物） ---------------- */

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('前端未构建。开发时请运行 pnpm dev:web（或 pnpm build 后重启）。');
  });
}

/* ---------------- 404 / 错误 ---------------- */

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: '接口不存在' } });
});

app.use((err: any, req: any, res: any, _next: any) => {
  const status = err?.status || 500;
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);
  res.status(status).json({
    error: {
      code: err?.code || 'internal',
      message: err?.message || '服务器错误',
      detail: err?.detail,
    },
  });
});

/* ---------------- 启动 ---------------- */

app.listen(PORT, HOST, () => {
  console.log(`\n课堂互评系统已启动：http://localhost:${PORT}`);
  for (const url of lanUrls(PORT)) console.log(`  局域网：${url}`);
  console.log(`  数据目录：${DATA_DIR}\n`);
  resumePending();
});

// 每小时清理过期会话与登录失败记录
setInterval(
  () => {
    run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    run('DELETE FROM login_attempts WHERE created_at < ?', Date.now() - 86_400_000);
  },
  3_600_000,
).unref();

/* ---------------- helpers ---------------- */

function bootstrapAdmin() {
  const exists = one<any>("SELECT id FROM users WHERE role = 'admin'");
  if (exists) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin12345';
  const mustChange = password === 'admin12345' ? 1 : 0;
  run(
    `INSERT INTO users(role, username, password_hash, display_name, status, must_change_pwd, points_cached, created_at)
     VALUES('admin', ?, ?, '系统管理员', 'active', ?, 0, ?)`,
    username,
    hashPwd(password),
    mustChange,
    Date.now(),
  );
  console.log(`[init] 已创建超级管理员：${username}${mustChange ? '（首次登录需改密，默认密码 admin12345）' : ''}`);
}

function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`${name}  http://${a.address}:${port}`);
    }
  }
  return out;
}
