import { useEffect, useState } from 'react';
import { get, reportError } from '../api';

const REASON_TEXT: Record<string, string> = {
  participate: '完成参与',
  reaction_spend: '发表情',
  reaction_received: '收到的表情',
};

export default function StudentPoints({ nav }: { nav: (p: string) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [board, setBoard] = useState<any | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    get('/api/student/points').then(setData).catch((e) => setErr(e?.message ?? '加载失败'));
    get('/api/student/points/leaderboard')
      .then(setBoard)
      .catch(() => setBoard({ rows: [] }));
  }, []);

  if (err) return <div className="container"><div className="error-box">{err}</div></div>;
  if (!data) return <div className="spin">加载中…</div>;

  const rank = board?.myRank;

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <div className="card">
        <div className="spread">
          <div>
            <div className="muted">我的积分</div>
            <div style={{ fontSize: 34, fontWeight: 700, color: data.points < 0 ? 'var(--danger)' : undefined }}>
              {data.points}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted">班级排名</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{rank ? `第 ${rank} 名` : '—'}</div>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
          完成一次投票或评分 +10 · 发一个表情 −5 · 收到正面表情 +1
          {data.points < 5 && <div style={{ color: 'var(--danger)', marginTop: 4 }}>积分不足 5，暂时不能发表情</div>}
        </div>
      </div>

      <div className="card">
        <h3>班级排行榜</h3>
        {(board?.rows ?? []).length === 0 && <div className="muted">还没有数据</div>}
        {(board?.rows ?? []).map((r: any) => (
          <div
            key={r.id}
            className="spread"
            style={{
              padding: '8px 0',
              borderBottom: '1px solid var(--line)',
              background: r.isMe ? 'var(--brand-soft)' : 'transparent',
              borderRadius: r.isMe ? 8 : 0,
            }}
          >
            <div className="row" style={{ gap: 10 }}>
              <span style={{ width: 26, textAlign: 'center', fontWeight: 600 }}>{r.rank}</span>
              <span>
                {r.display_name}
                {r.isMe && <span className="badge badge-type" style={{ marginLeft: 6 }}>我</span>}
              </span>
            </div>
            <b>{r.points}</b>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>积分流水</h3>
        {data.ledger.length === 0 && <div className="muted">还没有记录</div>}
        {data.ledger.map((l: any) => (
          <div key={l.id} className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>
                {REASON_TEXT[l.reason] ?? String(l.reason).replace(/^manual:/, '教师调整：')}
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
    </div>
  );
}
