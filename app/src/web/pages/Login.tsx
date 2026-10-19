import { useState } from 'react';
import { post, reportError } from '../api';

export default function Login({ onLogin }: { onLogin: (user: any) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await post('/api/auth/login', { username: username.trim(), password });
      onLogin(r.user);
    } catch (e: any) {
      setErr(e?.message ?? '登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: '10vh' }}>
      <div className="card">
        <h2 style={{ marginBottom: 2 }}>课堂互评</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 18 }}>
          教师用教师账号登录，学生用学号登录
        </p>
        <form onSubmit={submit}>
          {err && <div className="error-box">{err}</div>}
          <div className="field">
            <label>账号 / 学号</label>
            <input
              type="text"
              value={username}
              autoComplete="username"
              autoFocus
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label>密码</label>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="hint">学生首次登录的初始密码就是学号</div>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || !username || !password}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
