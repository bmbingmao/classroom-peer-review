import { useEffect, useState } from 'react';
import { del, get, patch, post, reportError, toast } from '../api';

export default function TeacherGroups() {
  const [groups, setGroups] = useState<any[]>([]);
  const [current, setCurrent] = useState<any | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [importText, setImportText] = useState('');
  const [report, setReport] = useState<any | null>(null);
  const [openImport, setOpenImport] = useState(false);

  async function loadGroups(selectId?: number) {
    const r = await get('/api/teacher/groups');
    setGroups(r.groups);
    const target = selectId ? r.groups.find((g: any) => g.id === selectId) : r.groups[0];
    if (target) await select(target);
    else {
      setCurrent(null);
      setMembers([]);
    }
  }

  async function select(g: any) {
    setCurrent(g);
    const r = await get(`/api/teacher/groups/${g.id}/members`);
    setMembers(r.members);
  }

  useEffect(() => {
    loadGroups().catch(reportError);
  }, []);

  async function createGroup() {
    if (!newName.trim()) return;
    try {
      const r = await post('/api/teacher/groups', { name: newName.trim() });
      setNewName('');
      toast('已创建');
      await loadGroups(r.id);
    } catch (e) {
      reportError(e);
    }
  }

  async function renameGroup() {
    if (!current) return;
    const name = prompt('新的组名', current.name);
    if (!name || name === current.name) return;
    try {
      await patch(`/api/teacher/groups/${current.id}`, { name });
      await loadGroups(current.id);
    } catch (e) {
      reportError(e);
    }
  }

  async function deleteGroup() {
    if (!current) return;
    if (!confirm(`删除学生组「${current.name}」？\n学生账号会保留，只是不再属于这个组。`)) return;
    try {
      await del(`/api/teacher/groups/${current.id}`);
      toast('已删除');
      setCurrent(null);
      await loadGroups();
    } catch (e) {
      reportError(e);
    }
  }

  async function doImport() {
    if (!current) return;
    if (!importText.trim()) return toast('先粘贴学生名单');
    try {
      const r = await post(`/api/teacher/groups/${current.id}/import`, { text: importText });
      setReport(r);
      setImportText('');
      await select(current);
      await loadGroups(current.id);
      toast(`导入完成：新增 ${r.added}，已存在 ${r.reused}`);
    } catch (e) {
      reportError(e);
    }
  }

  async function resetPwd(m: any) {
    if (!confirm(`把「${m.display_name}」的密码重置为学号 ${m.username}？\n（该学生如果同时在别的老师名下，密码会一起变）`)) return;
    try {
      await post(`/api/teacher/groups/${current.id}/members/${m.id}/reset-password`);
      toast('已重置为学号');
      await select(current);
    } catch (e) {
      reportError(e);
    }
  }

  async function removeMember(m: any) {
    if (!confirm(`把「${m.display_name}」移出本组？账号不会被删除。`)) return;
    try {
      await del(`/api/teacher/groups/${current.id}/members/${m.id}`);
      await select(current);
      await loadGroups(current.id);
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div className="row">
          <input
            type="text"
            placeholder="新组名，例如 2026春-计算机1班"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1, minWidth: 180, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10 }}
          />
          <button className="btn btn-primary" onClick={createGroup}>
            新建组
          </button>
        </div>
      </div>

      {groups.length === 0 && <div className="card empty">还没有学生组。先建一个，再导入学生。</div>}

      {groups.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(200px,260px) 1fr', alignItems: 'start' }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <h3>我的组</h3>
            {groups.map((g) => (
              <div
                key={g.id}
                onClick={() => select(g)}
                style={{
                  padding: '9px 10px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  marginBottom: 4,
                  background: current?.id === g.id ? 'var(--brand-soft)' : 'transparent',
                  fontWeight: current?.id === g.id ? 600 : 400,
                }}
              >
                <div>{g.name}</div>
                <div className="muted">{g.member_count} 人</div>
              </div>
            ))}
          </div>

          <div style={{ minWidth: 0 }}>
            {!current && <div className="card empty">选一个组</div>}
            {current && (
              <>
                <div className="card">
                  <div className="spread">
                    <h2>{current.name}</h2>
                    <div className="row">
                      <button className="btn btn-sm" onClick={() => setOpenImport((v) => !v)}>
                        {openImport ? '收起导入' : '批量导入学生'}
                      </button>
                      <button className="btn btn-sm" onClick={renameGroup}>
                        重命名
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={deleteGroup}>
                        删除组
                      </button>
                    </div>
                  </div>

                  {openImport && (
                    <div style={{ marginTop: 14 }}>
                      <div className="field">
                        <label>每行一条：学号,姓名（也可以直接粘贴 Excel 两列）</label>
                        <textarea
                          value={importText}
                          onChange={(e) => setImportText(e.target.value)}
                          placeholder={'2023001,张三\n2023002,李四'}
                        />
                      </div>
                      <div className="row">
                        <button className="btn btn-primary btn-sm" onClick={doImport}>
                          导入
                        </button>
                        <span className="hint">初始密码 = 学号，学生第一次登录要改密</span>
                      </div>
                      {report && (
                        <div className="muted" style={{ marginTop: 10 }}>
                          新增 <b>{report.added}</b> · 已存在 <b>{report.reused}</b> · 已在组内 <b>{report.alreadyInGroup}</b>
                          {report.errors?.length > 0 && (
                            <div style={{ color: 'var(--danger)', marginTop: 6 }}>
                              {report.errors.map((e: any) => (
                                <div key={e.line}>
                                  第 {e.line} 行：{e.message}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="card">
                  <h3>组内学生（{members.length}）</h3>
                  {members.length === 0 && <div className="empty">还没有学生</div>}
                  {members.length > 0 && (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>学号</th>
                            <th>姓名</th>
                            <th>状态</th>
                            <th style={{ width: 170 }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {members.map((m) => (
                            <tr key={m.id}>
                              <td>{m.username}</td>
                              <td>{m.display_name}</td>
                              <td>{m.must_change_pwd ? <span className="badge badge-closed">未改密</span> : <span className="badge badge-open">正常</span>}</td>
                              <td>
                                <div className="row">
                                  <button className="btn btn-sm" onClick={() => resetPwd(m)}>
                                    重置密码
                                  </button>
                                  <button className="btn btn-sm btn-danger" onClick={() => removeMember(m)}>
                                    移出
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
