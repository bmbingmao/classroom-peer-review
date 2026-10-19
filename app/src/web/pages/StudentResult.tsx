import { useEffect, useState } from 'react';
import { fmtTime, get, reportError } from '../api';
import CommentWall from '../components/CommentWall';

export default function StudentResult({ id, nav }: { id: number; nav: (p: string) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    get(`/api/student/results/${id}`)
      .then(setData)
      .catch((e) => {
        setErr(e?.message ?? '加载失败');
        reportError(e);
      });
  }, [id]);

  // 活动进行中时轮询，看实时得票
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.hidden || data?.effective !== 'open') return;
      get(`/api/student/results/${id}`)
        .then(setData)
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(t);
  }, [id, data?.effective]);

  if (err)
    return (
      <div className="container">
        <div className="error-box">{err}</div>
        <button className="btn" onClick={() => nav('#/s')}>
          返回
        </button>
      </div>
    );
  if (!data) return <div className="spin">加载中…</div>;

  const maxCount = data.type === 'vote' ? Math.max(1, ...data.options.map((o: any) => o.count)) : 1;
  const maxTotal = data.type === 'score' ? Math.max(0.01, ...data.targets.map((t: any) => t.total ?? 0)) : 1;

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <div className="spread" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{data.title}</h2>
        <div className="row">
          {data.effective === 'open' && (
            <button className="btn btn-sm" onClick={() => nav(`#/s/${data.type === 'vote' ? 'vote' : 'score'}/${id}`)}>
              修改我的{data.type === 'vote' ? '选择' : '评分'}
            </button>
          )}
          <button className="btn btn-sm" onClick={() => nav('#/s')}>
            返回
          </button>
        </div>
      </div>

      {data.type === 'vote' && (
        <div className="card">
          <h3>实时票数</h3>
          {data.options.map((o: any) => (
            <div key={o.id} className={`bar-row ${o.top ? 'top' : ''}`}>
              <div>
                <div>
                  {o.text}
                  {o.top && <span className="crown">👑 当前最高</span>}
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.round((o.count / maxCount) * 100)}%` }} />
                </div>
              </div>
              <div style={{ fontWeight: 600, fontSize: 18 }}>{o.count}</div>
            </div>
          ))}
        </div>
      )}

      {data.type === 'score' && (
        <>
          <div className="card">
            <h3>各作品得分</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              成绩按去极值平均计算（去掉一个最高分和一个最低分后取平均），评委身份匿名。
            </p>
            {data.targets.map((t: any) => (
              <div key={t.id} style={{ padding: '12px 0', borderTop: '1px solid var(--line)' }}>
                <div className="spread">
                  <b>
                    {t.anon_label}
                    {t.mine && <span className="badge badge-type" style={{ marginLeft: 6 }}>我的作品</span>}
                  </b>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{t.total === null ? '暂无' : t.total.toFixed(2)}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.round(((t.total ?? 0) / maxTotal) * 100)}%` }} />
                </div>
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  {t.items
                    .map((it: any) => {
                      const meta = data.items.find((x: any) => x.id === it.itemId);
                      return `${meta?.name ?? ''} ${it.mean === null ? '—' : it.mean.toFixed(2)}`;
                    })
                    .join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 style={{ margin: '18px 0 10px' }}>评语墙</h3>
      <CommentWall activityId={id} />

      <div className="muted" style={{ textAlign: 'center', marginTop: 16 }}>
        {data.effective === 'ended' ? '活动已结束' : '数据实时更新'} · 截止 {fmtTime(data.end_at)}
      </div>
    </div>
  );
}
