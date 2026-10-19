import { useEffect, useState } from 'react';
import { get, post, reportError, toast } from '../api';

export default function StudentVote({ id, nav }: { id: number; nav: (p: string) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await get(`/api/student/activities/${id}`);
      setData(r);
      setSelected(r.myOptionIds ?? []);
      setComment(r.myComment ?? '');
      if (!r.activity.accepting) setErr('');
    } catch (e: any) {
      setErr(e?.message ?? '加载失败');
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  function toggle(optionId: number) {
    if (!data) return;
    const max = data.multiple ? data.maxChoices : 1;
    if (data.multiple) {
      if (selected.includes(optionId)) setSelected(selected.filter((x) => x !== optionId));
      else if (selected.length >= max) {
        toast(`最多只能选 ${max} 项`);
      } else setSelected([...selected, optionId]);
    } else {
      setSelected([optionId]);
    }
  }

  async function submit() {
    if (selected.length === 0) return toast('先选一项');
    setBusy(true);
    try {
      await post(`/api/student/activities/${id}/vote`, { optionIds: selected, comment: comment.trim() });
      toast('提交成功，+10 积分');
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
  const done = data.participated;
  const canEdit = a.accepting && done;

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <div className="spread" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{a.title}</h2>
        <button className="btn btn-sm" onClick={() => nav('#/s')}>
          返回
        </button>
      </div>

      {a.description && <div className="card">{a.description}</div>}

      {done && (
        <div className="card" style={{ background: 'var(--brand-soft)', borderColor: '#c9d8ff' }}>
          <div className="spread">
            <div>
              <b>你已提交过</b>
              <div className="muted">{a.accepting ? '截止前可以修改，改完不会重复加分' : '活动已结束，不能再修改'}</div>
            </div>
            {!a.accepting && (
              <button className="btn btn-sm" onClick={() => nav(`#/s/result/${id}`)}>
                看结果
              </button>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h3>{data.multiple ? `多选（最多 ${data.maxChoices} 项）` : '单选'}</h3>
        {data.options.map((o: any) => (
          <label
            key={o.id}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              padding: '12px 10px',
              borderBottom: '1px solid var(--line)',
              cursor: a.accepting || !done ? 'pointer' : 'default',
            }}
          >
            <input
              type={data.multiple ? 'checkbox' : 'radio'}
              name="opt"
              checked={selected.includes(o.id)}
              disabled={!a.accepting}
              onChange={() => toggle(o.id)}
              style={{ width: 20, height: 20 }}
            />
            <span style={{ fontSize: 16 }}>{o.text}</span>
            {o.image && <img src={o.image} alt="" style={{ height: 48, borderRadius: 8 }} />}
          </label>
        ))}
        <div style={{ marginTop: 16 }}>
          <div className="hint" style={{ marginBottom: 4 }}>
            写点评语（可选，审核通过后展示给同学）
          </div>
          <textarea
            value={comment}
            disabled={!a.accepting}
            maxLength={2000}
            placeholder="说说你为什么这么选…"
            onChange={(e) => setComment(e.target.value)}
            style={{
              width: '100%',
              minHeight: 70,
              padding: '10px 12px',
              border: '1px solid var(--line)',
              borderRadius: 10,
              fontFamily: 'inherit',
              fontSize: 14,
              resize: 'vertical',
              marginBottom: 12,
            }}
          />
          {a.accepting ? (
            <button className="btn btn-primary btn-block" disabled={busy || selected.length === 0} onClick={submit}>
              {busy ? '提交中…' : done ? '保存修改' : '提交投票（+10 积分）'}
            </button>
          ) : (
            <div className="muted">活动已结束</div>
          )}
          {canEdit && <div className="hint" style={{ marginTop: 8 }}>修改只覆盖原选择，不会重复加积分。</div>}
        </div>
      </div>
    </div>
  );
}
