import { useEffect, useState } from 'react';
import { get, post, reportError, toast } from '../api';

export default function AdminStudents() {
  const [students, setStudents] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  async function load(keyword = '') {
    setLoading(true);
    try {
      const r = await get(`/api/admin/students${keyword ? `?q=${encodeURIComponent(keyword)}` : ''}`);
      setStudents(r.students);
    } catch (e) {
      reportError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(reportError);
  }, []);

  async function resetPwd(s: any) {
    if (!confirm(`把「${s.username} ${s.display_name}」的密码重置成学号？\n下次登录会被要求改密码。`)) return;
    try {
      const r = await post(`/api/admin/students/${s.id}/reset-password`, {});
      toast(`已重置，新密码就是 ${r.username}`);
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="container">
      <div className="spread">
        <h2 style={{ margin: 0 }}>学生信息</h2>
        <span className="hint">共 {students.length} 人（最多显示 500）</span>
      </div>

      <div className="card">
        <div className="row">
          <input
            type="text"
            placeholder="搜索学号或姓名"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(q)}
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={() => load(q)}>
            搜索
          </button>
          {q && (
            <button
              className="btn"
              onClick={() => {
                setQ('');
                load('');
              }}
            >
              清除
            </button>
          )}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p className="hint">加载中…</p>
        ) : students.length === 0 ? (
          <p className="hint">没有匹配的学生</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>学号</th>
                  <th>姓名</th>
                  <th>当前积分</th>
                  <th>累计获得</th>
                  <th>所属组</th>
                  <th>所属教师</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td>{s.username}</td>
                    <td>{s.display_name}</td>
                    <td>{s.points_cached}</td>
                    <td className="muted">{s.earned ?? 0}</td>
                    <td>{s.groups_text || <span className="hint">未分组</span>}</td>
                    <td>{s.teachers_text || <span className="hint">—</span>}</td>
                    <td>
                      {s.status === 'active' ? '正常' : '已停用'}
                      {s.must_change_pwd ? <span className="hint">（待改密）</span> : null}
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={() => resetPwd(s)}>
                        重置密码
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
