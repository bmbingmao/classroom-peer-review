import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { one, run } from '../db.ts';
import {
  COOKIE,
  clearFailures,
  cookieOptions,
  createSession,
  destroySession,
  hashPwd,
  loginKey,
  recordFailure,
  tooManyAttempts,
  verifyPwd,
} from '../auth.ts';
import { HttpError, bad, str, unauthorized } from '../util.ts';

const router = Router();

router.get('/me', (req: any, res) => {
  const u = req.user;
  if (!u) throw unauthorized();
  const extra: any = {};
  if (u.role === 'student') {
    const row = one<any>('SELECT points_cached FROM users WHERE id = ?', u.id);
    extra.points = row?.points_cached ?? 0;
  }
  res.json({ user: u, ...extra });
});

router.post('/login', (req: any, res) => {
  const username = str(req.body?.username, '账号', 64);
  const password = str(req.body?.password, '密码', 128);
  const key = loginKey(req, username);

  if (tooManyAttempts(key)) {
    throw new HttpError(429, 'too_many_attempts', '登录失败次数过多，请 5 分钟后再试');
  }

  const user = one<any>('SELECT * FROM users WHERE username = ?', username);
  if (!user || user.status !== 'active' || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailure(key);
    throw unauthorized('账号或密码错误');
  }

  clearFailures(key);
  const token = createSession(user.id);
  res.cookie(COOKIE, token, cookieOptions());
  res.json({
    user: {
      id: user.id,
      role: user.role,
      username: user.username,
      display_name: user.display_name,
      must_change_pwd: user.must_change_pwd,
    },
    must_change_pwd: !!user.must_change_pwd,
  });
});

router.post('/logout', (req: any, res) => {
  const token = req.cookies?.[COOKIE];
  if (token) destroySession(token);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});


/** 改用户名（需要密码确认） */
router.post('/change-username', (req: any, res) => {
  const u = req.user;
  if (!u) throw unauthorized();
  const password = str(req.body?.password, '密码', 128);
  const newUsername = str(req.body?.newUsername, '新账号', 64).trim();

  if (!/^[0-9A-Za-z_.-]{3,32}$/.test(newUsername)) {
    throw bad('账号只能是 3-32 位字母、数字、下划线、点或横线');
  }
  const row = one<any>('SELECT password_hash FROM users WHERE id = ?', u.id);
  if (!row || !verifyPwd(password, row.password_hash)) throw bad('密码不正确');

  const dup = one<any>('SELECT id FROM users WHERE username = ? AND id <> ?', newUsername, u.id);
  if (dup) throw bad(`账号 ${newUsername} 已被占用`);

  run('UPDATE users SET username = ? WHERE id = ?', newUsername, u.id);
  res.json({ ok: true, username: newUsername });
});

router.post('/change-password', (req: any, res) => {
  const u = req.user;
  if (!u) throw unauthorized();
  const oldPwd = str(req.body?.oldPassword, '旧密码', 128);
  const newPwd = str(req.body?.newPassword, '新密码', 128);
  if (newPwd.length < 6) throw bad('新密码至少 6 位');
  if (newPwd === oldPwd) throw bad('新密码不能与旧密码相同');

  const row = one<any>('SELECT password_hash FROM users WHERE id = ?', u.id);
  if (!row || !verifyPwd(oldPwd, row.password_hash)) throw bad('旧密码不正确');

  run('UPDATE users SET password_hash = ?, must_change_pwd = 0 WHERE id = ?', hashPwd(newPwd), u.id);
  // 改密后让其他会话失效（保留当前会话）
  const token = req.cookies?.[COOKIE];
  run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', u.id, token ?? '');
  res.json({ ok: true });
});

export default router;
