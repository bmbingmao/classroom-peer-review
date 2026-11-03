import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime, get, patch, post, put, reportError, statusClass, STATUS_TEXT, toast } from '../api';
import { BarChart, RadarChart } from '../components/Chart';

type Tab = 'result' | 'score' | 'comments' | 'chart' | 'people';

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
          ...(data.type === 'score' ? [['score', '🧑‍🏫 教师评分']] : []),
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
          <ScoringSettings data={data} onSaved={load} />

          {data.targets.map((t: any) => {
            const owner = ownerOf(t.id);
            return (
              <div className="card" key={t.id}>
                <div className="spread">
                  <h3 style={{ margin: 0 }}>
                    {t.anon_label}
                    {owner && <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>实际：{owner}</span>}
                    {t.hidden && <span className="badge badge-ended" style={{ marginLeft: 8 }}>已隐藏</span>}
                    {!t.teacherScored && (
                      <span className="badge badge-pending" style={{ marginLeft: 8 }}>
                        教师未打分
                      </span>
                    )}
                  </h3>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {t.total === null ? '—' : t.total.toFixed(2)}
                    <span className="muted" style={{ fontSize: 13, fontWeight: 400, marginLeft: 4 }}>
                      合计
                    </span>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  学生互评 {t.studentTotal === null ? '—' : t.studentTotal.toFixed(2)}
                  {' · '}教师 {t.teacherTotal === null ? '未打分' : t.teacherTotal.toFixed(2)}
                  {' · '}教师权重 {data.scoring?.teacherWeight ?? 60}%
                </div>
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>评分项</th>
                        <th>学生均分</th>
                        <th>教师</th>
                        <th>合计</th>
                        <th>人数 n</th>
                        <th>剔除（低/高）</th>
                        <th>被剔除的分数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.items.map((it: any) => {
                        const meta = items.find((x: any) => x.id === it.itemId);
                        const trimmed = (it.low ?? 0) + (it.high ?? 0) > 0;
                        return (
                          <tr key={it.itemId}>
                            <td>
                              {meta?.name}
                              <span className="muted" style={{ marginLeft: 6 }}>
                                （{meta?.min_score}~{meta?.max_score}，权重 {meta?.weight}）
                              </span>
                            </td>
                            <td>{it.mean === null ? '—' : it.mean.toFixed(2)}</td>
                            <td>{it.teacher === null ? <span className="muted">—</span> : it.teacher.toFixed(2)}</td>
                            <td style={{ fontWeight: 600 }}>{it.combined === null ? '—' : it.combined.toFixed(2)}</td>
                            <td>{it.n}</td>
                            <td>
                              {trimmed ? (
                                <>
                                  {it.low} / {it.high}
                                  {it.auto && <span className="muted" style={{ fontSize: 12 }}> 自动</span>}
                                </>
                              ) : (
                                <span className="muted">不剔除</span>
                              )}
                            </td>
                            <td className="muted" style={{ fontSize: 12 }}>
                              {!trimmed ? (
                                '—'
                              ) : (
                                <>
                                  {(it.low ?? 0) > 0 && (
                                    <>
                                      低：
                                      {it.removedLow
                                        .map((e: any) => `${judgeName(e.label, e.studentId)} ${e.score}`)
                                        .join('、')}
                                    </>
                                  )}
                                  {(it.low ?? 0) > 0 && (it.high ?? 0) > 0 && <br />}
                                  {(it.high ?? 0) > 0 && (
                                    <>
                                      高：
                                      {it.removedHigh
                                        .map((e: any) => `${judgeName(e.label, e.studentId)} ${e.score}`)
                                        .join('、')}
                                    </>
                                  )}
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

      {tab === 'score' && data.type === 'score' && <TeacherScorePanel data={data} onSaved={load} />}

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

/* ==================== 计分设置：教师权重 + 两端剔除数 ==================== */

function ScoringSettings({ data, onSaved }: { data: any; onSaved: () => void }) {
  const s = data.scoring ?? {};
  const [weight, setWeight] = useState(String(s.teacherWeight ?? 60));
  const [auto, setAuto] = useState<boolean>(s.auto !== false);
  const [low, setLow] = useState(String(s.trimLow ?? 1));
  const [high, setHigh] = useState(String(s.trimHigh ?? 1));
  const [busy, setBusy] = useState(false);

  async function save(payload: any) {
    setBusy(true);
    try {
      await patch(`/api/teacher/activities/${data.id}/scoring-settings`, payload);
      toast('已保存，分数已按新规则重算');
      onSaved();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { width: 76, padding: '7px 10px', borderRadius: 10, border: '1px solid var(--line)' } as const;

  return (
    <div className="card">
      <div className="spread">
        <h3 style={{ margin: 0 }}>计分规则</h3>
        <div className="muted" style={{ fontSize: 13 }}>
          {s.teacherScoredCount > 0 ? `已录入 ${s.teacherScoredCount} 项教师分数` : '还没有教师分数'}
        </div>
      </div>

      <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 10 }}>
        <span>教师评分占比</span>
        <input style={inputStyle} type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />
        <span className="muted">%　其余 {Math.max(0, 100 - (Number(weight) || 0))}% 给学生互评</span>
        {[60, 70, 50].map((v) => (
          <button key={v} className="btn btn-sm" onClick={() => setWeight(String(v))}>
            {v}/{100 - v}
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 12 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          按规则自动剔除（n ≥ 5 时两端各 k = max(1, ⌈n×5%⌉) 个）
        </label>
      </div>

      {!auto && (
        <div className="row" style={{ gap: 10, alignItems: 'center', marginTop: 10 }}>
          <span>剔除最低分</span>
          <input style={inputStyle} type="number" min={0} max={50} value={low} onChange={(e) => setLow(e.target.value)} />
          <span>个</span>
          <span style={{ marginLeft: 8 }}>剔除最高分</span>
          <input style={inputStyle} type="number" min={0} max={50} value={high} onChange={(e) => setHigh(e.target.value)} />
          <span>个</span>
        </div>
      )}

      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        针对恶意压分可以把「最低分」多剔一个；作品虚高可以把「最高分」多剔一个。改完立即按新规则重算，可随时改回。
        剔除后至少保留 1 个分数。
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() =>
            save(
              auto
                ? { teacherWeight: Number(weight), auto: true }
                : { teacherWeight: Number(weight), trimLow: Number(low), trimHigh: Number(high) },
            )
          }
        >
          保存规则
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={() => save({ auto: true })}>
          恢复自动剔除
        </button>
      </div>
    </div>
  );
}

/* ==================== 教师打分面板 ==================== */

function TeacherScorePanel({ data, onSaved }: { data: any; onSaved: () => void }) {
  const items: any[] = data.items ?? [];
  const targets: any[] = data.targets ?? [];
  const [draft, setDraft] = useState<Record<number, Record<number, string>>>(() => {
    const m: Record<number, Record<number, string>> = {};
    for (const t of targets) {
      m[t.id] = {};
      for (const it of t.items) m[t.id][it.itemId] = it.teacher === null ? '' : String(it.teacher);
    }
    return m;
  });
  const [busy, setBusy] = useState<number | null>(null);

  function setVal(targetId: number, itemId: number, v: string) {
    setDraft((d) => ({ ...d, [targetId]: { ...(d[targetId] ?? {}), [itemId]: v } }));
  }

  async function save(t: any, clear = false) {
    const row = clear ? {} : draft[t.id] ?? {};
    const scores = items
      .filter((it) => row[it.id] !== undefined && String(row[it.id]).trim() !== '')
      .map((it) => ({ itemId: it.id, score: Number(row[it.id]) }));
    setBusy(t.id);
    try {
      await put(`/api/teacher/activities/${data.id}/teacher-scores`, { targetId: t.id, scores });
      if (clear) setDraft((d) => ({ ...d, [t.id]: {} }));
      toast(clear ? '已清空该作品的教师分' : `已保存 ${t.anon_label} 的教师分`);
      onSaved();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>教师本人打分</h3>
        <p className="muted" style={{ margin: 0 }}>
          按评分项给每个作品打分，教师分参与合计计算（当前占比 {data.scoring?.teacherWeight ?? 60}%）。
          只填一部分也可以，没填的评分项按学生互评均分算；一个都没填就完全按学生互评算。
        </p>
      </div>

      {targets.map((t: any) => {
        const row = draft[t.id] ?? {};
        const filled = items.filter((it) => String(row[it.id] ?? '').trim() !== '').length;
        return (
          <div className="card" key={t.id}>
            <div className="spread">
              <h3 style={{ margin: 0 }}>
                {t.anon_label}
                <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
                  学生互评 {t.studentTotal === null ? '—' : t.studentTotal.toFixed(2)}
                  {t.teacherTotal !== null ? ` · 教师 ${t.teacherTotal.toFixed(2)}` : ''}
                </span>
              </h3>
              <span className="muted" style={{ fontSize: 13 }}>
                已填 {filled}/{items.length}
              </span>
            </div>
            <div className="grid" style={{ marginTop: 10 }}>
              {items.map((it) => (
                <div key={it.id} className="spread" style={{ gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div>{it.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {it.min_score}~{it.max_score}
                      {it.weight ? ` · 权重 ${it.weight}` : ''}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={it.min_score}
                    max={it.max_score}
                    value={row[it.id] ?? ''}
                    placeholder="—"
                    onChange={(e) => setVal(t.id, it.id, e.target.value)}
                    style={{ width: 92, padding: '7px 10px', borderRadius: 10, border: '1px solid var(--line)', textAlign: 'right' }}
                  />
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btn-primary btn-sm" disabled={busy === t.id} onClick={() => save(t)}>
                保存 {t.anon_label}
              </button>
              <button className="btn btn-sm" disabled={busy === t.id} onClick={() => save(t, true)}>
                清空
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
