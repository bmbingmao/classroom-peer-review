import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime, get, patch, post, reportError, statusClass, STATUS_TEXT, toast } from '../api';
import { BarChart, RadarChart } from '../components/Chart';

type Tab = 'result' | 'comments' | 'chart' | 'people';

export default function TeacherResult({ id, nav }: { id: number; nav: (p: string) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [words, setWords] = useState<any[]>([]);
  const [identities, setIdentities] = useState<any | null>(null);
  const [showIdentity, setShowIdentity] = useState(false);
  const [tab, setTab] = useState<Tab>('result');
  const [err, setErr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [barItem, setBarItem] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  async function load() {
    try {
      const r = await get(`/api/teacher/results/${id}`);
      setData(r);
      const c = await get(`/api/teacher/activities/${id}/comments`);
      setComments(c.comments);
      setErr('');
    } catch (e: any) {
      setErr(e?.message ?? '加载失败');
    }
  }

  async function loadWords() {
    try {
      const w = await get(`/api/teacher/activities/${id}/words`);
      setWords(w.words);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
    loadWords();
    timer.current = window.setInterval(() => {
      if (!document.hidden) load();
    }, 3000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [id]);

  async function toggleIdentity() {
    if (showIdentity) {
      setShowIdentity(false);
      return;
    }
    try {
      const r = await get(`/api/teacher/activities/${id}/identities`);
      setIdentities(r);
      setShowIdentity(true);
      toast('已显示真实身份（仅你看得到）');
    } catch (e) {
      reportError(e);
    }
  }

  const judgeName = (label: string, studentId?: number) => {
    if (!showIdentity || !identities || !studentId) return label;
    const j = identities.judges.find((x: any) => x.id === studentId);
    return j ? `${j.display_name}(${j.username})` : label;
  };

  const authorOf = (c: any) => {
    if (!showIdentity || !identities) return '匿名学生';
    const a = (identities.commentAuthors ?? []).find((x: any) => x.id === c.student_id);
    return a ? `${a.display_name}(${a.username})` : '匿名学生';
  };

  const ownerOf = (targetId: number) => {
    if (!showIdentity || !identities) return null;
    const t = identities.targets.find((x: any) => x.targetId === targetId);
    return t?.name ? `${t.name}(${t.username ?? ''})` : null;
  };

  async function moderate(comment: any, action: 'approve' | 'reject') {
    let reason = '';
    if (action === 'reject') {
      reason = prompt('驳回原因（学生会看到折叠提示，看不到内容）', comment.ai_category || '') ?? '';
      if (reason === null) return;
    }
    try {
      await post(`/api/teacher/comments/${comment.id}/moderate`, { action, reason });
      toast(action === 'approve' ? '已放行' : '已驳回');
      load();
      loadWords();
    } catch (e) {
      reportError(e);
    }
  }

  async function unfold(comment: any) {
    try {
      await post(`/api/teacher/comments/${comment.id}/fold`, { folded: false });
      toast('已恢复展示');
      load();
    } catch (e) {
      reportError(e);
    }
  }

  async function closeActivity() {
    if (!confirm('关闭后学生不能再提交，确定？')) return;
    try {
      await patch(`/api/teacher/activities/${id}`, { status: 'closed' });
      toast('已关闭');
      load();
    } catch (e) {
      reportError(e);
    }
  }

  const pending = useMemo(() => comments.filter((c) => c.moderation_status === 'pending'), [comments]);
  const approved = useMemo(() => comments.filter((c) => c.moderation_status === 'approved'), [comments]);
  const rejected = useMemo(() => comments.filter((c) => c.moderation_status === 'rejected'), [comments]);

  if (err)
    return (
      <div className="container">
        <div className="error-box">{err}</div>
        <button className="btn" onClick={() => nav('#/t/activities')}>
          返回列表
        </button>
      </div>
    );
  if (!data) return <div className="spin">加载中…</div>;

  const joinUrl = `${location.origin}/`;
  const maxCount = data.type === 'vote' ? Math.max(1, ...data.options.map((o: any) => o.count)) : 1;
  const items = data.type === 'score' ? data.items : [];
  const activeBarItem = barItem ?? (items[0]?.id ?? null);

  return (
    <div className="container">
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{data.title}</h2>
          <div className="row" style={{ marginTop: 6 }}>
            <span className={statusClass(data.effective)}>{STATUS_TEXT[data.effective]}</span>
            <span className="muted">
              已交 {data.submittedCount} / {data.invitedCount} 人 · 截止 {fmtTime(data.end_at)}
            </span>
          </div>
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => setShowQr((v) => !v)}>
            {showQr ? '收起二维码' : '入场二维码'}
          </button>
          <button className="btn btn-sm" onClick={toggleIdentity}>
            {showIdentity ? '🙈 隐藏身份' : '👁 显示真实身份'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              if (!confirm('导出文件包含学生真实姓名和学号，会记录导出人。继续？')) return;
              window.location.href = `/api/teacher/activities/${id}/export`;
            }}
          >
            导出 Excel
          </button>
          {data.effective === 'open' && (
            <button className="btn btn-sm btn-danger" onClick={closeActivity}>
              关闭
            </button>
          )}
          <button className="btn btn-sm" onClick={() => nav('#/t/activities')}>
            返回
          </button>
        </div>
      </div>

      {showQr && (
        <div className="card">
          <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
            <img className="qr" src={`/api/qr?text=${encodeURIComponent(joinUrl)}`} alt="入场二维码" />
            <div style={{ flex: 1, minWidth: 200 }}>
              <h3>扫码入场</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                投屏这个二维码，学生用手机扫码 → 用学号和密码登录 → 直接看到要参与的评价。
              </p>
              <div className="row">
                <code style={{ fontSize: 13, background: '#f1f4fa', padding: '6px 10px', borderRadius: 8 }}>{joinUrl}</code>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(joinUrl);
                    toast('链接已复制');
                  }}
                >
                  复制
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="card" style={{ borderColor: '#f4d9b4', background: '#fdf8ef' }}>
          <div className="spread">
            <div>
              <b>有 {pending.length} 条评语待你审核</b>
              <div className="muted">AI 没判或没配 AI 时，需要你手动放行/驳回。</div>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => setTab('comments')}>
              去审核
            </button>
          </div>
        </div>
      )}

      <div className="nav" style={{ padding: '0 0 10px', maxWidth: 'none' }}>
        {[
          ['result', '结果'],
          ['comments', `评语 ${approved.length}`],
          ['chart', '图表'],
          ['people', `未交 ${data.absentees.length}`],
        ].map(([key, label]) => (
          <a
            key={key}
            href="javascript:void 0"
            className={tab === key ? 'active' : ''}
            onClick={(e) => {
              e.preventDefault();
              setTab(key as Tab);
            }}
          >
            {label}
          </a>
        ))}
      </div>

      {tab === 'result' && data.type === 'vote' && (
        <div className="card">
          <h3>实时票数</h3>
          {data.options.map((o: any) => (
            <div key={o.id} className={`bar-row ${o.top ? 'top' : ''}`}>
              <div style={{ minWidth: 0 }}>
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
          <div className="muted" style={{ marginTop: 12 }}>
            共 {data.submittedCount} 人投票 · 每 3 秒自动刷新
          </div>
        </div>
      )}

      {tab === 'result' && data.type === 'score' && (
        <>
          <div className="card">
            <h3>去极值说明</h3>
            <p className="muted" style={{ margin: 0 }}>
              每个项目的分数按 <b>(分数升序, 学号)</b> 排序后，两端各去掉 k 个再取平均。规则：人数 n &lt; 5 不去极值；n ≥ 5
              时 k = max(1, ⌈n×5%⌉)，并保证剩下的分数不少于 3 个。
            </p>
          </div>

          {data.targets.map((t: any) => {
            const owner = ownerOf(t.id);
            return (
              <div className="card" key={t.id}>
                <div className="spread">
                  <h3 style={{ margin: 0 }}>
                    {t.anon_label}
                    {owner && <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>实际：{owner}</span>}
                    {t.hidden && <span className="badge badge-ended" style={{ marginLeft: 8 }}>已隐藏</span>}
                  </h3>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {t.total === null ? '—' : t.total.toFixed(2)}
                    <span className="muted" style={{ fontSize: 13, fontWeight: 400, marginLeft: 4 }}>
                      加权总分
                    </span>
                  </div>
                </div>
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>评分项</th>
                        <th>去极值均分</th>
                        <th>原始均分</th>
                        <th>人数 n</th>
                        <th>两端各剔</th>
                        <th>被剔除的分数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.items.map((it: any) => {
                        const meta = items.find((x: any) => x.id === it.itemId);
                        return (
                          <tr key={it.itemId}>
                            <td>
                              {meta?.name}
                              <span className="muted" style={{ marginLeft: 6 }}>
                                （{meta?.min_score}~{meta?.max_score}，权重 {meta?.weight}）
                              </span>
                            </td>
                            <td style={{ fontWeight: 600 }}>{it.mean === null ? '—' : it.mean.toFixed(2)}</td>
                            <td className="muted">{it.rawMean === null ? '—' : it.rawMean.toFixed(2)}</td>
                            <td>{it.n}</td>
                            <td>{it.k === 0 ? <span className="muted">不去极值</span> : it.k}</td>
                            <td className="muted" style={{ fontSize: 12 }}>
                              {it.k === 0 ? (
                                '—'
                              ) : (
                                <>
                                  低：{it.removedLow.map((e: any) => `${judgeName(e.label, e.studentId)} ${e.score}`).join('、')}
                                  <br />
                                  高：{it.removedHigh.map((e: any) => `${judgeName(e.label, e.studentId)} ${e.score}`).join('、')}
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}

      {tab === 'chart' && data.type === 'score' && (
        <>
          <div className="card">
            <div className="spread">
              <h3 style={{ margin: 0 }}>各作品在单项上的对比</h3>
              <select
                value={activeBarItem ?? ''}
                onChange={(e) => setBarItem(Number(e.target.value))}
                style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid var(--line)' }}
              >
                {items.map((it: any) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
            </div>
            <BarChart
              labels={data.targets.map((t: any) => t.anon_label)}
              values={data.targets.map((t: any) => t.items.find((x: any) => x.itemId === activeBarItem)?.mean ?? null)}
              max={items.find((i: any) => i.id === activeBarItem)?.max_score ?? 10}
              min={items.find((i: any) => i.id === activeBarItem)?.min_score ?? 0}
            />
            <div className="muted" style={{ marginTop: 6 }}>
              纵轴是该项的分数区间（{items.find((i: any) => i.id === activeBarItem)?.min_score ?? 0}~
              {items.find((i: any) => i.id === activeBarItem)?.max_score ?? 10}），柱高是去极值均分。
            </div>
          </div>

          <div className="grid">
            {data.targets.map((t: any) => (
              <div className="card" key={t.id} style={{ marginBottom: 0 }}>
                <h3 style={{ marginBottom: 4 }}>
                  {t.anon_label}
                  <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                    {t.total === null ? '—' : t.total.toFixed(2)}
                  </span>
                </h3>
                <RadarChart
                  axes={items.map((it: any) => it.name)}
                  values={t.items.map((it: any, idx: number) => {
                    const meta = items[idx];
                    if (it.mean === null) return null;
                    // 各评分项区间不同，统一折算到 0~10 再画，避免尺度误导
                    const span = (meta.max_score - meta.min_score) || 1;
                    return ((it.mean - meta.min_score) / span) * 10;
                  })}
                  max={10}
                  size={240}
                />
                <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
                  已按各评分项区间折算成 0~10
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'comments' && (
        <>
          {words.length > 0 && (
            <div className="card">
              <h3>评语热词</h3>
              <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                {words.map((w: any) => (
                  <span
                    key={w.word}
                    style={{
                      fontSize: Math.min(26, 12 + w.count * 2),
                      color: w.count > 2 ? 'var(--brand)' : 'var(--ink-2)',
                      fontWeight: w.count > 2 ? 600 : 400,
                    }}
                  >
                    {w.word}
                  </span>
                ))}
              </div>
            </div>
          )}

          {pending.length > 0 && (
            <div className="card">
              <h3>待审（{pending.length}）</h3>
              {pending.map((c) => (
                <CommentRow key={c.id} c={c} author={authorOf(c)} onApprove={() => moderate(c, 'approve')} onReject={() => moderate(c, 'reject')} />
              ))}
            </div>
          )}

          <div className="card">
            <h3>已通过（{approved.length}）</h3>
            {approved.length === 0 && <div className="muted">还没有已通过的评语</div>}
            {approved.map((c) => (
              <CommentRow
                key={c.id}
                c={c}
                author={authorOf(c)}
                folded={c.folded === 1}
                onReject={() => moderate(c, 'reject')}
                onUnfold={() => unfold(c)}
              />
            ))}
          </div>

          {rejected.length > 0 && (
            <div className="card">
              <h3>已驳回（{rejected.length}）</h3>
              <div className="muted" style={{ marginBottom: 8 }}>
                学生看不到这里的内容，只有你能展开。
              </div>
              {rejected.map((c) => (
                <CommentRow key={c.id} c={c} author={authorOf(c)} onApprove={() => moderate(c, 'approve')} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'people' && (
        <div className="card">
          <h3>还没交的人（{data.absentees.length}）</h3>
          {data.absentees.length === 0 ? (
            <div className="muted">全员已提交 🎉</div>
          ) : (
            <div className="row">
              {data.absentees.map((s: any) => (
                <span key={s.id} className="badge badge-ended">
                  {s.display_name}（{s.username}）
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="muted" style={{ textAlign: 'center' }}>
        数据每 3 秒自动刷新 · 活动 #{data.id} · 版本 {data.version}
      </div>
    </div>
  );
}

function CommentRow({
  c,
  author,
  folded,
  onApprove,
  onReject,
  onUnfold,
}: {
  c: any;
  author: string;
  folded?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onUnfold?: () => void;
}) {
  const statusText = { approved: '已通过', pending: '待审', rejected: '已驳回' }[c.moderation_status as string] ?? c.moderation_status;
  const reactions: Record<string, number> = c.reactions ?? {};
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <div className="spread">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {author} · {statusText}
            {c.ai_category ? ` · AI：${c.ai_category}` : ''}
            {c.reject_reason ? ` · 原因：${c.reject_reason}` : ''}
            {folded ? ' · 已折叠' : ''}
          </div>
          {Object.keys(reactions).length > 0 && (
            <div className="row" style={{ gap: 8, marginTop: 4, fontSize: 13 }}>
              {Object.entries(reactions).map(([emoji, n]) => (
                <span key={emoji}>
                  {emoji} {n}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {onApprove && (
            <button className="btn btn-sm btn-primary" onClick={onApprove}>
              放行
            </button>
          )}
          {onReject && (
            <button className="btn btn-sm btn-danger" onClick={onReject}>
              驳回
            </button>
          )}
          {onUnfold && (
            <button className="btn btn-sm" onClick={onUnfold}>
              恢复展示
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
