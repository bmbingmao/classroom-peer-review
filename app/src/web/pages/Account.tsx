import { useState } from 'react';
import { post, toast } from '../api';

export default function Account({ user, onChanged }: { user: any; onChanged: () => void }) {
  const [newUsername, setNewUsername] = useState(user?.username ?? '');
  const [uPwd, setUPwd] = useState('');
  const [changingName, setChangingName] = useState(false);

  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);

  async function submitUsername(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim() || newUsername.trim() === user.username) return toast('新账号没变化');
    setChangingName(true);
    try {
      await post('/api/auth/change-username', { password: uPwd, newUsername: newUsername.trim() });
      toast('账号已修改');
      setUPwd('');
      onChanged();
    } catch (e: any) {
      toast(e?.message || '修改失败');
    } finally {
      setChangingName(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPwd.length < 6) return toast('新密码至少 6 位');
    if (newPwd !== confirmPwd) return toast('两次输入的新密码不一致');
    setChangingPwd(true);
    try {
      await post('/api/auth/change-password', { oldPassword: oldPwd, newPassword: newPwd });
      toast('密码已修改');
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
    } catch (e: any) {
      toast(e?.message || '修改失败');
    } finally {
      setChangingPwd(false);
    }
  }

  return (
    <div className="container">
      <h2>账号设置</h2>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>修改用户名</h3>
        <p className="hint">当前账号：<b>{user?.username}</b></p>
        <form onSubmit={submitUsername}>
          <label>新用户名</label>
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="3-32 位字母、数字、下划线、点或横线"
          />
          <label>当前密码（确认身份）</label>
          <input type="password" value={uPwd} onChange={(e) => setUPwd(e.target.value)} placeholder="输入当前密码" />
          <button className="btn btn-primary" disabled={changingName || !uPwd || !newUsername.trim()}>
            {changingName ? '提交中…' : '保存新用户名'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>修改密码</h3>
        <form onSubmit={submitPassword}>
          <label>当前密码</label>
          <input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
          <label>新密码（至少 6 位）</label>
          <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          <label>再输一次新密码</label>
          <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
          <button className="btn btn-primary" disabled={changingPwd || !oldPwd || !newPwd}>
            {changingPwd ? '提交中…' : '保存新密码'}
          </button>
        </form>
      </div>
    </div>
  );
}
