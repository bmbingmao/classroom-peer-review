import { useEffect, useState } from 'react';
import { fmtDateInput, fromDateInput, get, post, reportError, toast, uploadMedia } from '../api';

type Vec3 = { text: string; image?: string };
type Item = { name: string; min: number; max: number; weight: number };
type Target = { anonLabel: string; studentId: string; media: { kind: string; url: string }[] };

export default function TeacherNew({ type, nav }: { type: 'vote' | 'score'; nav: (p: string) => void }) {
  const isVote = type === 'vote';
  const [groups, setGroups] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [groupIdSet, setGroupIdSet] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [startAt, setStartAt] = useState(fmtDateInput(Date.now()));
  const [endAt, setEndAt] = useState(fmtDateInput(Date.now() + 3600_000));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // vote
  const [options, setOptions] = useState<Vec3[]>([{ text: '' }, { text: '' }]);
  const [multiple, setMultiple] = useState(false);
  const [maxChoices, setMaxChoices] = useState(2);

  // score
  const [items, setItems] = useState<Item[]>([
    { name: '完成度', min: 1, max: 10, weight: 50 },
    { name: '美观度', min: 1, max: 10, weight: 50 },
  ]);
  const [targets, setTargets] = useState<Target[]>([{ anonLabel: '作品A', studentId: '', media: [] }]);

  // 评分项模板 / 上次用的
  const [rubrics, setRubrics] = useState<{ templates: any[]; recent: any[] }>({ templates: [], recent: [] });
  const [rubricPick, setRubricPick] = useState('');
  const [bulkGroup, setBulkGroup] = useState('');

  useEffect(() => {
    get('/api/teacher/groups')
      .then((r) => {
        setGroups(r.groups);
        if (r.groups.length === 1) setGroupIdSet([r.groups[0].id]);
      })
      .catch(reportError);
    get('/api/teacher/students')
      .then((r) => setStudents(r.students))
      .catch(() => {});

    if (!isVote) {
      get('/api/teacher/rubrics')
        .then((r) => setRubrics(r))
        .catch(() => {});
      // 上次用过的那套评分项，直接带出来，省得每次重敲
      try {
        const last = localStorage.getItem('lastRubric');
        if (last) {
          const parsed = JSON.parse(last);
          if (Array.isArray(parsed) && parsed.length && parsed.every((x) => x?.name)) setItems(parsed);
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

  function applyRubric(value: string) {
    setRubricPick(value);
    if (!value) return;
    const [kind, id] = value.split(':');
    const src =
      kind === 't'
        ? rubrics.templates.find((t) => String(t.id) === id)?.items
        : rubrics.recent.find((r) => String(r.activityId) === id)?.items;
    if (Array.isArray(src) && src.length) {
      setItems(src.map((i: any) => ({ name: i.name, min: i.min ?? i.min_score ?? 1, max: i.max ?? i.max_score ?? 10, weight: i.weight ?? 1 })));
      if (kind === 't') post(`/api/teacher/rubrics/${id}/use`).catch(() => {});
      toast('已套用');
    }
  }

  async function saveTemplate() {
    if (!items.length) return toast('先填几个评分项');
    const name = prompt('给这套评分项起个名字（同名会覆盖）', title.trim() || '常用评分项');
    if (!name?.trim()) return;
    try {
      await post('/api/teacher/rubrics', { name: name.trim(), items });
      const r = await get('/api/teacher/rubrics');
      setRubrics(r);
      toast('已存为模板');
    } catch (e) {
      reportError(e);
    }
  }

  function toggleGroup(id: number) {
    setGroupIdSet((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setErr('');
    if (!title.trim()) return setErr('标题不能为空');
    if (groupIdSet.length === 0) return setErr('至少要勾选一个参与组');
    const s = fromDateInput(startAt);
    const e = fromDateInput(endAt);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return setErr('时间填错了');
    if (e <= s) return setErr('截止时间必须晚于开始时间');

    if (isVote) {
      if (options.filter((o) => o.text.trim()).length < 2) return setErr('至少要有 2 个有文字的选项');
    } else {
      if (items.length === 0) return setErr('至少要有 1 个评分项');
      for (const it of items) {
        if (!it.name.trim()) return setErr('评分项名称不能为空');
        if (it.max <= it.min) return setErr(`评分项「${it.name}」的最高分必须大于最低分`);
      }
      if (targets.length === 0) return setErr('至少要有 1 个被评对象');
    }

    const payload: any = {
      type,
      title: title.trim(),
      description,
      anonymous,
      startAt: s,
      endAt: e,
      groupIds: groupIdSet,
    };
    if (isVote) {
      payload.options = options
        .filter((o) => o.text.trim())
        .map((o) => ({ text: o.text.trim(), image: o.image ?? '' }));
      payload.multiple = multiple;
      payload.maxChoices = maxChoices;
    } else {
      payload.items = items;
      payload.targets = targets.map((t) => ({
        anonLabel: t.anonLabel,
        studentId: t.studentId ? Number(t.studentId) : null,
        media: t.media,
      }));
    }

    setBusy(true);
    try {
      const r = await post('/api/teacher/activities', payload);
      if (!isVote) localStorage.setItem('lastRubric', JSON.stringify(items));
      toast('已发起');
      nav(`#/t/result/${r.id}`);
    } catch (e: any) {
      setErr(e?.message ?? '创建失败');
    } finally {
      setBusy(false);
    }
  }

  /** 作品A..Z，超过 26 个就用 编号27 */
  const anonLabelFor = (i: number) =>
    i < 26 ? `作品${String.fromCharCode(65 + i)}` : `编号${i + 1}`;

  /** 现有编号用到第几个了，接着往下编 */
  function nextAnonIndex(list: { anonLabel: string }[]): number {
    let max = -1;
    for (const t of list) {
      const m = /^作品([A-Z])$/.exec(t.anonLabel ?? '');
      if (m) max = Math.max(max, m[1].charCodeAt(0) - 65);
      const n = /^编号(\d+)$/.exec(t.anonLabel ?? '');
      if (n) max = Math.max(max, Number(n[1]) - 1);
    }
    return max + 1;
  }

  /** 学生下拉：按学生组分组显示 */
  function StudentOptions() {
    const ungrouped = students.filter((s) => !s.groups || s.groups.length === 0);
    return (
      <>
        <option value="">不关联</option>
        {groups.map((g) => {
          const members = students.filter((s) => (s.groups ?? []).some((x: any) => x.id === g.id));
          if (!members.length) return null;
          return (
            <optgroup key={g.id} label={`${g.name}（${members.length} 人）`}>
              {members.map((s) => (
                <option key={`${g.id}-${s.id}`} value={s.id}>
                  {s.username} {s.display_name}
                </option>
              ))}
            </optgroup>
          );
        })}
        {ungrouped.length > 0 && (
          <optgroup label="未分组">
            {ungrouped.map((s) => (
              <option key={`ng-${s.id}`} value={s.id}>
                {s.username} {s.display_name}
              </option>
            ))}
          </optgroup>
        )}
      </>
    );
  }

  /** 把一个学生组的成员一次性加成被评对象 */
  function addGroupTargets() {
    if (!bulkGroup) return;
    const gid = Number(bulkGroup);
    const g = groups.find((x) => x.id === gid);
    const members = students.filter((s) => (s.groups ?? []).some((x: any) => x.id === gid));
    if (!members.length) return toast('这个组里还没有学生');

    const existing = new Set(targets.map((t) => t.studentId).filter(Boolean));
    const fresh = members.filter((s) => !existing.has(String(s.id)));
    if (!fresh.length) return toast('这个组的学生都已经加进来了');

    // 表单还是空的时候（只有没关联学生的占位行），直接把它们换掉，避免出现重复编号
    const realOnes = targets.filter((t: any) => t.studentId || (t.media?.length ?? 0) > 0);
    const base = realOnes.length ? targets : [];
    const startIdx = base.length ? nextAnonIndex(base) : 0;
    const added = fresh.map((s, i) => ({
      anonLabel: anonLabelFor(startIdx + i),
      studentId: String(s.id),
      media: [],
    }));
    setTargets([...base, ...added]);
    // 被评对象在这组，评委一般也来自这组，顺手勾上
    if (g && !groupIdSet.includes(g.id)) setGroupIdSet([...groupIdSet, g.id]);
    setBulkGroup('');
    toast(`已添加 ${added.length} 个被评对象${g && !groupIdSet.includes(g.id) ? '，并把「' + g.name + '」设为参与组' : ''}`);
  }

  async function upload(targetIndex: number, file: File | undefined) {
    if (!file) return;
    try {
      const r = await uploadMedia(file);
      setTargets((prev) => prev.map((t, i) => (i === targetIndex ? { ...t, media: [...t.media, r] } : t)));
      toast('已上传');
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <div className="spread" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{isVote ? '发起投票' : '发起评分'}</h2>
        <button className="btn btn-sm" onClick={() => nav('#/t/activities')}>
          返回
        </button>
      </div>

      {err && <div className="error-box">{err}</div>}

      <div className="card">
        <div className="field">
          <label>标题</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isVote ? '例如：最受欢迎作品' : '例如：作品互评（3月）'} />
        </div>
        <div className="field">
          <label>说明（可选，学生能看到）</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label>参与的学生组（可多选）</label>
          {groups.length === 0 && <div className="hint">还没有学生组，先去「学生组」建一个</div>}
          <div className="row">
            {groups.map((g) => (
              <label key={g.id} className="btn btn-sm" style={{ cursor: 'pointer', background: groupIdSet.includes(g.id) ? 'var(--brand-soft)' : '#fff', borderColor: groupIdSet.includes(g.id) ? 'var(--brand-2)' : 'var(--line)' }}>
                <input type="checkbox" checked={groupIdSet.includes(g.id)} onChange={() => toggleGroup(g.id)} style={{ marginRight: 6 }} />
                {g.name}（{g.member_count}）
              </label>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 18 }}>
          <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
            <label>开始时间</label>
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
            <label>截止时间（到点自动关闭）</label>
            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
          <label>
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} style={{ marginRight: 6 }} />
            匿名（学生之间看不到谁投的/谁评的；老师仍可查看真实身份）
          </label>
        </div>
      </div>

      {isVote && (
        <div className="card">
          <div className="spread">
            <h3 style={{ margin: 0 }}>投票选项（最多 10 个）</h3>
            <button className="btn btn-sm" disabled={options.length >= 10} onClick={() => setOptions([...options, { text: '' }])}>
              + 加一个
            </button>
          </div>
          {options.map((o, i) => (
            <div key={i} className="row" style={{ marginTop: 8 }}>
              <input
                type="text"
                value={o.text}
                placeholder={`选项 ${i + 1}`}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                style={{ flex: 1, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 10 }}
              />
              {o.image && <img src={o.image} alt="" style={{ height: 38, borderRadius: 8, border: '1px solid var(--line)' }} />}
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                {o.image ? '换图' : '配图'}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const up = await uploadMedia(f);
                      setOptions((prev) => prev.map((x, j) => (j === i ? { ...x, image: up.url } : x)));
                    } catch (err) {
                      reportError(err);
                    }
                  }}
                />
              </label>
              <button className="btn btn-sm btn-danger" disabled={options.length <= 2} onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                删
              </button>
            </div>
          ))}
          <div className="row" style={{ marginTop: 14 }}>
            <label>
              <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} style={{ marginRight: 6 }} />
              允许多选
            </label>
            {multiple && (
              <label className="row" style={{ gap: 6 }}>
                最多选
                <input
                  type="number"
                  min={1}
                  max={options.length}
                  value={maxChoices}
                  onChange={(e) => setMaxChoices(Number(e.target.value))}
                  style={{ width: 70, padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 8 }}
                />
                项
              </label>
            )}
          </div>
        </div>
      )}

      {!isVote && (
        <>
          <div className="card">
            <div className="spread">
              <h3 style={{ margin: 0 }}>评分项（最多 20 项）</h3>
              <button className="btn btn-sm" disabled={items.length >= 20} onClick={() => setItems([...items, { name: '', min: 1, max: 10, weight: 10 }])}>
                + 加一项
              </button>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              权重是相对值，系统按 Σ(均分×权重)/Σ权重 算总分；权重全填 0 会自动按等权。
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <select
                value={rubricPick}
                onChange={(e) => applyRubric(e.target.value)}
                style={{ flex: 1, minWidth: 200, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)' }}
              >
                <option value="">套用模板 / 上次的评分项…</option>
                {rubrics.templates.length > 0 && (
                  <optgroup label="我的模板">
                    {rubrics.templates.map((t: any) => (
                      <option key={t.id} value={`t:${t.id}`}>
                        {t.name}（{t.items.length} 项）
                      </option>
                    ))}
                  </optgroup>
                )}
                {rubrics.recent.length > 0 && (
                  <optgroup label="最近用过">
                    {rubrics.recent.map((r: any) => (
                      <option key={r.activityId} value={`a:${r.activityId}`}>
                        {r.title}（{r.items.length} 项）
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button className="btn btn-sm" onClick={saveTemplate}>
                存为模板
              </button>
            </div>
            {items.map((it, i) => (
              <div key={i} className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
                <div style={{ flex: 2, minWidth: 140 }}>
                  <div className="hint">项目名称</div>
                  <input
                    type="text"
                    value={it.name}
                    placeholder="例如：完成度"
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 10 }}
                  />
                </div>
                <div style={{ width: 76 }}>
                  <div className="hint">最低分</div>
                  <input
                    type="number"
                    value={it.min}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))}
                    style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 10 }}
                  />
                </div>
                <div style={{ width: 76 }}>
                  <div className="hint">最高分</div>
                  <input
                    type="number"
                    value={it.max}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, max: Number(e.target.value) } : x)))}
                    style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 10 }}
                  />
                </div>
                <div style={{ width: 76 }}>
                  <div className="hint">权重</div>
                  <input
                    type="number"
                    value={it.weight}
                    min={0}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
                    style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 10 }}
                  />
                </div>
                <button className="btn btn-sm btn-danger" disabled={items.length <= 1} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  删
                </button>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="spread">
              <h3 style={{ margin: 0 }}>被评对象（最多 50 个）</h3>
              <button
                className="btn btn-sm"
                disabled={targets.length >= 50}
                onClick={() =>
                  setTargets([...targets, { anonLabel: anonLabelFor(targets.length), studentId: '', media: [] }])
                }
              >
                + 加一个
              </button>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              学生只看得到「作品A」这样的匿名编号，真实对应关系只有你能看到。
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <select
                value={bulkGroup}
                onChange={(e) => setBulkGroup(e.target.value)}
                style={{ flex: 1, minWidth: 180, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)' }}
              >
                <option value="">按学生组批量添加被评对象…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}（{students.filter((s) => (s.groups ?? []).some((x: any) => x.id === g.id)).length} 人）
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" disabled={!bulkGroup} onClick={addGroupTargets}>
                批量添加
              </button>
            </div>
            {targets.map((t, i) => (
              <div key={i} style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
                <div className="row">
                  <div style={{ width: 130 }}>
                    <div className="hint">匿名编号</div>
                    <input
                      type="text"
                      value={t.anonLabel}
                      onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, anonLabel: e.target.value } : x)))}
                      style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 10 }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div className="hint">关联学生（可选，仅你可见）</div>
                    <select
                      value={t.studentId}
                      onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, studentId: e.target.value } : x)))}
                      style={{ width: '100%', padding: '9px 10px', border: '1px solid var(--line)', borderRadius: 10 }}
                    >
                      <StudentOptions />
                    </select>
                  </div>
                  <div>
                    <div className="hint">作品（图/视频）</div>
                    <label className="btn btn-sm" style={{ cursor: 'pointer', display: 'inline-block' }}>
                      上传
                      <input type="file" accept="image/*,video/mp4" hidden onChange={(e) => upload(i, e.target.files?.[0])} />
                    </label>
                  </div>
                  <button className="btn btn-sm btn-danger" disabled={targets.length <= 1} onClick={() => setTargets(targets.filter((_, j) => j !== i))}>
                    删
                  </button>
                </div>
                {t.media.length > 0 && (
                  <div className="row" style={{ marginTop: 8 }}>
                    {t.media.map((m, k) => (
                      <div key={k} className="row" style={{ gap: 6 }}>
                        {m.kind.startsWith('image') ? (
                          <img src={m.url} alt="" style={{ height: 64, borderRadius: 8, border: '1px solid var(--line)' }} />
                        ) : (
                          <span className="badge badge-type">视频已上传</span>
                        )}
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => setTargets(targets.map((x, j) => (j === i ? { ...x, media: x.media.filter((_, n) => n !== k) } : x)))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="sticky-submit">
        <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>
          {busy ? '创建中…' : isVote ? '发起投票' : '发起评分'}
        </button>
      </div>
    </div>
  );
}
