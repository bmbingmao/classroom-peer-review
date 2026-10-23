import { useEffect, useState } from 'react';
import { get, post, reportError, toast } from '../api';

const REASON_TEXT: Record<string, string> = {
  participate: '完成参与',
  reaction_spend: '发表情',
  reaction_received: '收到的表情',
};

export default function TeacherPoints() {
  const [groups, setGroups] = useState<any[]>([]);
  const [groupId, setGroupId] = useState<number | ''>('');
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    get('/api/teacher/points/groups')
      .then((r) => {
        setGroups(r.groups);
        if (r.groups.length) setGroupId(r.groups[0].id);
      })
      .catch(reportError);
  }, []);

  async function loadBoard(gid: number | '') {
    try {
      const q = gid ? `?groupId=${gid}` : '';
      const r = await get(`/api/teacher/points/leaderboard${q}`);
      setRows(r.rows);
    } catch (e) {
      reportError(e);
    }
  }

  useEffect(() => {
    loadBoard(groupId);
  }, [groupId]);

  async function pick(row: any) {
    setSelected(row);
    try {
      const r = await get(`/api/teacher/points/ledger?studentId=${row.id}`);
      setLedger(r.ledger);
    } catch (e) {
      setErr(String((e as any)?.message ?? e));
    }
  }

  async function adjust() {
    if (!selected) return;
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) return toast('填一个非 0 的整数');
    if (!reason.trim()) return toast('必须填写原因');
    try {
      const r = await post('/api/teacher/points/adjust', { studentId: selected.id, delta: d, reason: reason.trim() });
      toast(`已调整 ${r.actual > 0 ? '+' : ''}${r.actual}`);
      setDelta('');
      setReason('');
      await loadBoard(groupId);
      await pick({ ...selected, points: r.points });
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div className="spread">
          <h3 style={{ margin: 0 }}>积分排行榜</h3>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : '')}
            style={{ padding: '7px 10px', borderRadius: 10, border: '1px solid var(--line)' }}
          >
            <option value="">全部学生</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>学号</th>
                <th>姓名</th>
                <th>当前积分</th>
                <th>累计获得</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ background: selected?.id === r.id ? 'var(--brand-soft)' : undefined }}>
                  <td>{r.rank}</td>
                  <td>{r.username}</td>
                  <td>{r.display_name}</td>
                  <td>
                    <b>{r.points}</b>
                  </td>
                  <td className="muted">{r.earned ?? '—'}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => pick(r)}>
                      加减分 / 流水
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    没有学生
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <>
          <div className="card">
            <h3>
              {selected.display_name}（{selected.username}） · 当前 {selected.points} 分
            </h3>
            <div className="row">
              <input
                type="number"
                placeholder="+5 或 -3"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                style={{ width: 110, padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 10 }}
              />
              <input
                type="text"
                placeholder="原因（必填，会进流水）"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ flex: 1, minWidth: 180, padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 10 }}
              />
              <button className="btn btn-primary" onClick={adjust}>
                提交
              </button>
            </div>
            <div className="hint">
              积分**可以为负**（扣成负分也允许，负分学生不能发点赞类表情）；单次调整范围 ±1000。
            </div>
          </div>

          <div className="card">
            <h3>流水</h3>
            {ledger.length === 0 && <div className="muted">还没有记录</div>}
            {ledger.map((l) => (
              <div key={l.id} className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <div>
                  <div style={{ fontSize: 14 }}>
                    {REASON_TEXT[l.reason] ?? String(l.reason).replace(/^manual:/, '手动：')}
                    {l.activity_title ? <span className="muted"> · {l.activity_title}</span> : ''}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {new Date(l.created_at).toLocaleString('zh-CN')}
                  </div>
                </div>
                <b style={{ color: l.delta > 0 ? 'var(--ok)' : 'var(--danger)' }}>{l.delta > 0 ? `+${l.delta}` : l.delta}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
