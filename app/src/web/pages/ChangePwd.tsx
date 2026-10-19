import { useState } from 'react';
import { post } from '../api';

export default function ChangePwd({ forced, onDone }: { forced?: boolean; onDone: () => void }) {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (newPassword.length < 6) return setErr('新密码至少 6 位');
    if (newPassword !== confirm) return setErr('两次输入的新密码不一致');
    setBusy(true);
    try {
      await post('/api/auth/change-password', { oldPassword, newPassword });
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? '修改失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: forced ? '8vh' : 24 }}>
      <div className="card">
        <h2>{forced ? '首次登录，请修改初始密码' : '修改密码'}</h2>
        {forced && <p className="muted">不改密码进不去系统。旧密码就是你的学号。</p>}
        <form onSubmit={submit}>
          {err && <div className="error-box">{err}</div>}
          <div className="field">
            <label>旧密码</label>
            <input type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>新密码（至少 6 位）</label>
            <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
          </div>
          <div className="field">
            <label>再输一次新密码</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy || !oldPassword || !newPassword}>
            {busy ? '提交中…' : '确认修改'}
          </button>
        </form>
      </div>
    </div>
  );
}
