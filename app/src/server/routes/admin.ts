import { Router } from 'express';
import { all, one, run, tx } from '../db.ts';
import { hashPwd } from '../auth.ts';
import { bad, int, notFound, str } from '../util.ts';

const router = Router();

router.get('/teachers', (_req: any, res) => {
  res.json({
    teachers: all(
      `SELECT u.id, u.username, u.display_name, u.status, u.created_at,
              (SELECT COUNT(*) FROM teacher_students t WHERE t.teacher_id = u.id) AS student_count,
              (SELECT COUNT(*) FROM activities a WHERE a.teacher_id = u.id) AS activity_count
         FROM users u WHERE u.role = 'teacher' ORDER BY u.id DESC`,
    ),
  });
});

router.post('/teachers', (req: any, res) => {
  const username = str(req.body?.username, '教师账号', 64);
  const displayName = str(req.body?.display_name, '教师姓名', 64);
  const password = str(req.body?.password, '初始密码', 128);
  if (password.length < 6) throw bad('初始密码至少 6 位');
  if (!/^[0-9A-Za-z_.-]+$/.test(username)) throw bad('教师账号只能包含字母、数字、下划线、点和横线');

  const exists = one<any>('SELECT id FROM users WHERE username = ?', username);
  if (exists) throw bad(`账号 ${username} 已存在`);

  const r = run(
    `INSERT INTO users(role, username, password_hash, display_name, status, must_change_pwd, points_cached, created_at)
     VALUES('teacher', ?, ?, ?, 'active', 0, 0, ?)`,
    username,
    hashPwd(password),
    displayName,
    Date.now(),
  );
  res.json({ id: Number(r.lastInsertRowid) });
});

router.patch('/teachers/:id', (req: any, res) => {
  const id = int(req.params.id, 'id');
  const t = one<any>("SELECT * FROM users WHERE id = ? AND role = 'teacher'", id);
  if (!t) throw notFound('教师不存在');
  const status = str(req.body?.status, 'status', 16);
  if (!['active', 'disabled'].includes(status)) throw bad('status 只能是 active 或 disabled');
  run('UPDATE users SET status = ? WHERE id = ?', status, id);
  if (status === 'disabled') run('DELETE FROM sessions WHERE user_id = ?', id);
  res.json({ ok: true });
});

router.post('/teachers/:id/reset-password', (req: any, res) => {
  const id = int(req.params.id, 'id');
  const t = one<any>("SELECT * FROM users WHERE id = ? AND role = 'teacher'", id);
  if (!t) throw notFound('教师不存在');
  const password = str(req.body?.password, '新密码', 128);
  if (password.length < 6) throw bad('密码至少 6 位');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPwd(password), id);
  run('DELETE FROM sessions WHERE user_id = ?', id);
  res.json({ ok: true });
});

router.get('/status', (_req: any, res) => {
  const c = (sql: string) => (one<{ c: number }>(sql)?.c ?? 0);
  res.json({
    version: '0.1.0',
    counts: {
      teachers: c("SELECT COUNT(*) AS c FROM users WHERE role='teacher'"),
      students: c("SELECT COUNT(*) AS c FROM users WHERE role='student'"),
      activities: c('SELECT COUNT(*) AS c FROM activities'),
      pendingComments: c("SELECT COUNT(*) AS c FROM comments WHERE moderation_status='pending'"),
      sessions: c('SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ' + Date.now()),
    },
  });
});

export default router;
