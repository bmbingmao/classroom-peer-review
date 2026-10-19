import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, put, reportError, toast } from '../api';

type Scores = Record<string, number>;

export default function StudentScore({ id, nav }: { id: number; nav: (p: string) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [scores, setScores] = useState<Scores>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const firstLoad = useRef(true);

  async function load() {
    try {
      const r = await get(`/api/student/activities/${id}`);
      setData(r);
      const initial: Scores = {};
      if (r.draft && typeof r.draft === 'object') {
        for (const [k, v] of Object.entries(r.draft)) {
          if (typeof v === 'number') initial[k] = v;
        }
      } else if (r.myScores?.length) {
        for (const s of r.myScores) initial[`${s.target_id}:${s.item_id}`] = s.score;
      }
      // 本地兜底：只有比服务端草稿更新时用
      const localRaw = localStorage.getItem(`draft:${id}`);
      if (localRaw && r.activity.accepting) {
        try {
          const local = JSON.parse(localRaw);
          if (local?.savedAt && (!r.draft || local.savedAt > Date.now() - 1000) && Object.keys(initial).length === 0) {
            Object.assign(initial, local.scores ?? {});
          }
        } catch {
          /* ignore */
        }
      }
      setScores(initial);
      const cs: Record<string, string> = {};
      for (const c of r.myComments ?? []) {
        if (c.target_id) cs[String(c.target_id)] = c.content;
      }
      setComments(cs);
      setErr('');
    } catch (e: any) {
      setErr(e?.message ?? '加载失败');
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  // 改动后 1.2 秒自动存草稿（先写本地，再写服务端）
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    if (!data?.activity?.accepting) return;
    localStorage.setItem(`draft:${id}`, JSON.stringify({ savedAt: Date.now(), scores }));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaving(true);
      put(`/api/student/activities/${id}/draft`, { payload: scores })
        .then(() => setSavedAt(Date.now()))
        .catch(() => {})
        .finally(() => setSaving(false));
    }, 1200);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores]);

  const total = useMemo(() => {
    if (!data) return 0;
    return data.items.length * data.targets.length;
  }, [data]);

  const filled = useMemo(() => {
    if (!data) return 0;
    let n = 0;
    for (const t of data.targets) for (const it of data.items) if (typeof scores[`${t.id}:${it.id}`] === 'number') n += 1;
    return n;
  }, [data, scores]);

  function setScore(targetId: number, itemId: number, value: number, min: number, max: number) {
    const v = Math.max(min, Math.min(max, Math.round(value)));
    setScores((prev) => ({ ...prev, [`${targetId}:${itemId}`]: v }));
  }

  async function submit() {
    if (!data) return;
    if (filled < total) {
      toast(`还有 ${total - filled} 格没打分，必须打满才能提交`);
      return;
    }
    setBusy(true);
    try {
      const arr: any[] = [];
      for (const t of data.targets) {
        for (const it of data.items) {
          const key = `${t.id}:${it.id}`;
          arr.push({ targetId: t.id, itemId: it.id, score: scores[key] });
        }
      }
      const commentList = Object.entries(comments)
        .filter(([, text]) => text.trim())
        .map(([targetId, text]) => ({ targetId: Number(targetId), content: text.trim() }));
      await post(`/api/student/activities/${id}/submit`, { scores: arr, comments: commentList });
      localStorage.removeItem(`draft:${id}`);
      toast(data.submitted ? '已保存修改' : '提交成功，+10 积分');
      nav(`#/s/result/${id}`);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

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

  const a = data.activity;

  return (
    <div className="container" style={{ maxWidth: 720, paddingBottom: 108 }}>
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{a.title}</h2>
          <div className="muted">
            {a.accepting ? '打分后会自动存草稿，刷新不会丢' : '活动已结束'}
            {data.submitted && ' · 你已提交，可继续修改'}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => nav('#/s')}>
          返回
        </button>
      </div>

      {a.description && <div className="card">{a.description}</div>}

      <div className="card" style={{ position: 'sticky', top: 56, zIndex: 10 }}>
        <div className="spread">
          <b>
            已填 {filled} / {total} 格
          </b>
          <span className="muted">{saving ? '保存中…' : savedAt ? '草稿已保存' : ''}</span>
        </div>
        <div className="bar-track" style={{ marginTop: 8 }}>
          <div className="bar-fill" style={{ width: `${total ? Math.round((filled / total) * 100) : 0}%` }} />
        </div>
      </div>

      {data.targets.map((t: any) => (
        <div className="target-card" key={t.id}>
          <h3>
            <span>{t.anon_label}</span>
          </h3>
          {t.media?.length > 0 && (
            <div className="row" style={{ marginBottom: 12 }}>
              {t.media.map((m: any, k: number) =>
                m.kind?.startsWith('video') ? (
                  <video key={k} src={m.url} controls style={{ width: '100%', borderRadius: 10 }} />
                ) : (
                  <img key={k} src={m.url} alt="" style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
                ),
              )}
            </div>
          )}
          {data.items.map((it: any) => {
            const key = `${t.id}:${it.id}`;
            const v = scores[key];
            const has = typeof v === 'number';
            return (
              <div key={it.id} style={{ marginBottom: 10 }}>
                <div className="spread">
                  <span>
                    {it.name}
                    <span className="muted" style={{ marginLeft: 6 }}>
                      {it.min_score}~{it.max_score}
                    </span>
                  </span>
                  {!has && <span className="badge badge-pending">未填</span>}
                </div>
                <div className="slider-row">
                  <input
                    type="range"
                    min={it.min_score}
                    max={it.max_score}
                    step={1}
                    value={has ? v : it.min_score}
                    disabled={!a.accepting}
                    onChange={(e) => setScore(t.id, it.id, Number(e.target.value), it.min_score, it.max_score)}
                  />
                  <input
                    className="score-num"
                    type="number"
                    min={it.min_score}
                    max={it.max_score}
                    value={has ? v : ''}
                    disabled={!a.accepting}
                    placeholder="—"
                    onChange={(e) => {
                      if (e.target.value === '') {
                        setScores((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        });
                      } else {
                        setScore(t.id, it.id, Number(e.target.value), it.min_score, it.max_score);
                      }
                    }}
                  />
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 12 }}>
            <div className="hint" style={{ marginBottom: 4 }}>
              给 {t.anon_label} 写评语（可选，审核通过后展示给同学）
            </div>
            <textarea
              value={comments[String(t.id)] ?? ''}
              disabled={!a.accepting}
              maxLength={2000}
              placeholder="说说这件作品好在哪里、哪里还能改进…"
              onChange={(e) => setComments((prev) => ({ ...prev, [String(t.id)]: e.target.value }))}
              style={{
                width: '100%',
                minHeight: 70,
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: 10,
                fontFamily: 'inherit',
                fontSize: 14,
                resize: 'vertical',
              }}
            />
          </div>
        </div>
      ))}

      <div className="sticky-submit">
        {a.accepting ? (
          <button className="btn btn-primary btn-block" disabled={busy || filled < total} onClick={submit}>
            {busy ? '提交中…' : filled < total ? `还差 ${total - filled} 格，打满才能提交` : data.submitted ? '保存修改' : '提交评分（+10 积分）'}
          </button>
        ) : (
          <button className="btn btn-block" onClick={() => nav(`#/s/result/${id}`)}>
            活动已结束，看结果
          </button>
        )}
      </div>
    </div>
  );
}
