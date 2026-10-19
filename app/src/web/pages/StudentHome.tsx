import { useEffect, useState } from 'react';
import { fmtTime, get, reportError, STATUS_TEXT } from '../api';

export default function StudentHome({ nav }: { nav: (p: string) => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    get('/api/student/activities')
      .then((r) => setList(r.activities))
      .catch((e) => {
        reportError(e);
        setList([]);
      });
    get('/api/auth/me')
      .then((r) => setPoints(r.points ?? 0))
      .catch(() => {});
  }, [tick]);

  // 30 秒刷新一次状态（到期自动关、老师新发活动）
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) setTick((x) => x + 1);
    }, 30_000);
    return () => window.clearInterval(t);
  }, []);

  function open(a: any) {
    if (a.participated || a.effective === 'ended' || a.effective === 'closed') {
      nav(`#/s/result/${a.id}`);
    } else if (a.type === 'vote') {
      nav(`#/s/vote/${a.id}`);
    } else {
      nav(`#/s/score/${a.id}`);
    }
  }

  return (
    <div className="container">
      {points !== null && (
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => nav('#/s/points')}>
          <div className="spread">
            <div>
              <div className="muted">我的积分</div>
              <div style={{ fontSize: 30, fontWeight: 700 }}>{points}</div>
            </div>
            <div className="muted" style={{ textAlign: 'right', maxWidth: 260 }}>
              每完成一次投票或评分 +10
              <div style={{ color: 'var(--brand-2)' }}>看排行榜与流水 →</div>
            </div>
          </div>
        </div>
      )}

      {list === null && <div className="spin">加载中…</div>}
      {list !== null && list.length === 0 && <div className="card empty">现在没有需要你参与的评价。</div>}

      <div className="grid">
        {(list ?? []).map((a) => {
          const todo = !a.participated && a.effective === 'open';
          const cls = todo ? 'act todo' : a.participated ? 'act done' : 'act';
          return (
            <div key={a.id} className={cls} onClick={() => open(a)} style={{ cursor: 'pointer' }}>
              <div className="act-title">{a.title}</div>
              <div className="muted">
                {a.type === 'vote' ? '投票' : '评分'} · {STATUS_TEXT[a.effective]} · 截止 {fmtTime(a.end_at)}
              </div>
              <div style={{ marginTop: 10, fontWeight: 600 }}>
                {a.participated ? '✓ 已参与（可点开看结果）' : a.effective === 'open' ? '点这里去参与 →' : '未参与'}
              </div>
              {a.participated && a.effective === 'open' && (
                <button
                  className="btn btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    nav(`#/s/${a.type === 'vote' ? 'vote' : 'score'}/${a.id}`);
                  }}
                >
                  修改{a.type === 'vote' ? '选择' : '评分'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
