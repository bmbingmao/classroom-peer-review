import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, run } from './db.ts';
import { forbidden, unauthorized } from './util.ts';

export const COOKIE = 'sid';
const SESSION_DAYS = 7;
export const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

export type Role = 'admin' | 'teacher' | 'student';

export type SessionUser = {
  id: number;
  role: Role;
  username: string;
  display_name: string;
  must_change_pwd: number;
  status: string;
};

export function hashPwd(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPwd(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  run(
    'INSERT INTO sessions(token, user_id, expires_at, created_at) VALUES(?,?,?,?)',
    token,
    userId,
    now + SESSION_DAYS * 86_400_000,
    now,
  );
  return token;
}

export function destroySession(token: string) {
  run('DELETE FROM sessions WHERE token = ?', token);
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: COOKIE_SECURE, // HTTP 局域网下必须为 false，否则登录后 cookie 不发送
    path: '/',
    maxAge: SESSION_DAYS * 86_400_000,
  };
}

/** 读取 cookie → 会话用户（过期顺带清掉） */
export function userFromRequest(req: any): SessionUser | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  const row = one<any>('SELECT expires_at FROM sessions WHERE token = ?', token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  const u = one<SessionUser>(
    `SELECT u.id, u.role, u.username, u.display_name, u.must_change_pwd, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
    token,
  );
  if (!u || u.status !== 'active') return null;
  return u;
}

/** 挂载 req.user（不强制登录） */
export function attachUser(req: any, _res: any, next: any) {
  req.user = userFromRequest(req);
  next();
}

/** 强制改密拦截：除白名单外一律 403 */
export function forceChangePwdGate(req: any, _res: any, next: any) {
  const u = req.user as SessionUser | null;
  if (!u || !u.must_change_pwd) return next();
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const allow = ['/api/auth/me', '/api/auth/logout', '/api/auth/change-password'];
  if (allow.includes(path)) return next();
  const err: any = new Error('请先修改初始密码');
  err.status = 403;
  err.code = 'must_change_pwd';
  return next(err);
}

export function requireLogin(req: any, _res: any, next: any) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: any, _res: any, next: any) => {
    const u = req.user as SessionUser | null;
    if (!u) return next(unauthorized());
    if (!roles.includes(u.role)) return next(forbidden());
    next();
  };
}

/** 登录限流：同 key 5 次失败冷却 5 分钟 */
const WINDOW = 5 * 60_000;
const MAX_FAIL = 5;

export function loginKey(req: any, username: string): string {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
  return `${ip}|${username}`;
}

export function tooManyAttempts(key: string): boolean {
  const since = Date.now() - WINDOW;
  const row = one<{ c: number }>(
    'SELECT COUNT(*) AS c FROM login_attempts WHERE key = ? AND created_at > ?',
    key,
    since,
  );
  return (row?.c ?? 0) >= MAX_FAIL;
}

export function recordFailure(key: string) {
  run('INSERT INTO login_attempts(key, created_at) VALUES(?,?)', key, Date.now());
}

export function clearFailures(key: string) {
  run('DELETE FROM login_attempts WHERE key = ?', key);
}
