import { useEffect, useState } from 'react';
import { get, post, reportError, toast } from '../api';

/** 学生端评语墙：只显示已通过且未折叠的评语，可发十种表情 */
export default function CommentWall({ activityId }: { activityId: number }) {
  const [data, setData] = useState<{ emojis: any[]; comments: any[] } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    try {
      const r = await get(`/api/student/activities/${activityId}/comments`);
      setData(r);
    } catch {
      setData({ emojis: [], comments: [] });
    }
  }

  useEffect(() => {
    load();
    const t = window.setInterval(() => {
      if (!document.hidden) load();
    }, 5000);
    return () => window.clearInterval(t);
  }, [activityId]);

  async function react(comment: any, emoji: string) {
    setBusy(comment.id);
    try {
      const r = await post(`/api/student/comments/${comment.id}/reaction`, { emoji });
      if (r.folded) toast('这条评语收到多次警报，已折叠');
      load();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <div className="spin">加载中…</div>;
  if (data.comments.length === 0)
    return <div className="card empty">评语还在审核中，通过后会出现在这里。</div>;

  return (
    <>
      {data.comments.map((c) => (
        <div className="card" key={c.id}>
          <div style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{c.content}</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {data.emojis.map((e: any) => {
              const count = c.reactions?.[e.key] ?? 0;
              const mine = c.myReaction === e.key;
              return (
                <button
                  key={e.key}
                  className="btn btn-sm"
                  disabled={c.isAuthor || busy === c.id}
                  title={c.isAuthor ? '不能给自己的评语发表情' : `${e.label}（${e.positive ? '扣 5 分，作者 +1' : '扣 5 分'}）`}
                  onClick={() => react(c, e.key)}
                  style={{
                    background: mine ? 'var(--brand-soft)' : '#fff',
                    borderColor: mine ? 'var(--brand-2)' : 'var(--line)',
                    opacity: count === 0 && !mine ? 0.72 : 1,
                  }}
                >
                  {e.key} {count > 0 ? count : ''}
                </button>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {c.isAuthor ? '这是你自己写的评语' : '发一个表情扣 5 积分；作者收到正面表情 +1'}
          </div>
        </div>
      ))}
    </>
  );
}
