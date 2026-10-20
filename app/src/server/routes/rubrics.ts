import { Router } from 'express';
import { all, one, run } from '../db.ts';
import { arr, bad, int, notFound, str } from '../util.ts';

const router = Router();

const MAX_ITEMS = 20;

/** 校验并规整评分项 */
function normalizeItems(raw: unknown) {
  const items = arr(raw, '评分项');
  if (items.length < 1) throw bad('至少要有 1 个评分项');
  if (items.length > MAX_ITEMS) throw bad(`评分项最多 ${MAX_ITEMS} 个`);
  return items.map((it: any, i: number) => {
    const name = str(it?.name, `评分项 ${i + 1} 名称`, 80);
    const min = int(it?.min ?? it?.min_score ?? 1, `评分项 ${i + 1} 最低分`, -10000, 10000);
    const max = int(it?.max ?? it?.max_score ?? 10, `评分项 ${i + 1} 最高分`, -10000, 10000);
    if (max <= min) throw bad(`评分项 ${i + 1} 的最高分必须大于最低分`);
    const weight = Number(it?.weight ?? 1);
    if (!Number.isFinite(weight) || weight < 0) throw bad(`评分项 ${i + 1} 的权重必须是非负数`);
    return { name, min, max, weight };
  });
}

/** 我的全部模板 + 最近用过的评分项（可直接套用） */
router.get('/rubrics', (req: any, res) => {
  const templates = all<any>(
    'SELECT id, name, items, use_count, updated_at FROM rubric_templates WHERE teacher_id = ? ORDER BY id DESC',
    req.user.id,
  ).map((t) => ({ ...t, items: safeJson(t.items, []) }));

  const acts = all<any>(
    "SELECT id, title, created_at FROM activities WHERE teacher_id = ? AND type = 'score' ORDER BY id DESC LIMIT 12",
    req.user.id,
  );
  const recent = acts
    .map((a) => {
      const items = all<any>(
        'SELECT name, min_score AS min, max_score AS max, weight FROM score_items WHERE activity_id = ? ORDER BY sort, id',
        a.id,
      );
      return items.length ? { activityId: a.id, title: a.title, created_at: a.created_at, items } : null;
    })
    .filter(Boolean);

  res.json({ templates, recent });
});

/** 存为模板（同名覆盖） */
router.post('/rubrics', (req: any, res) => {
  const name = str(req.body?.name, '模板名', 40);
  const items = normalizeItems(req.body?.items);
  const now = Date.now();

  const existing = one<any>('SELECT id FROM rubric_templates WHERE teacher_id = ? AND name = ?', req.user.id, name);
  if (existing) {
    run('UPDATE rubric_templates SET items = ?, updated_at = ? WHERE id = ?', JSON.stringify(items), now, existing.id);
    return res.json({ id: existing.id, updated: true });
  }
  const r = run(
    'INSERT INTO rubric_templates(teacher_id, name, items, use_count, created_at, updated_at) VALUES(?,?,?,0,?,?)',
    req.user.id,
    name,
    JSON.stringify(items),
    now,
    now,
  );
  res.json({ id: Number(r.lastInsertRowid), created: true });
});

/** 用一次，累计使用次数（用于排序/展示） */
router.post('/rubrics/:id/use', (req: any, res) => {
  const id = int(req.params.id, 'id');
  const t = one<any>('SELECT id FROM rubric_templates WHERE id = ? AND teacher_id = ?', id, req.user.id);
  if (!t) throw notFound('模板不存在');
  run('UPDATE rubric_templates SET use_count = use_count + 1 WHERE id = ?', id);
  res.json({ ok: true });
});

router.delete('/rubrics/:id', (req: any, res) => {
  const id = int(req.params.id, 'id');
  const t = one<any>('SELECT id FROM rubric_templates WHERE id = ? AND teacher_id = ?', id, req.user.id);
  if (!t) throw notFound('模板不存在');
  run('DELETE FROM rubric_templates WHERE id = ?', id);
  res.json({ ok: true });
});

router.patch('/rubrics/:id', (req: any, res) => {
  const id = int(req.params.id, 'id');
  const t = one<any>('SELECT id FROM rubric_templates WHERE id = ? AND teacher_id = ?', id, req.user.id);
  if (!t) throw notFound('模板不存在');
  const name = str(req.body?.name, '模板名', 40);
  run('UPDATE rubric_templates SET name = ?, updated_at = ? WHERE id = ?', name, Date.now(), id);
  res.json({ ok: true });
});

function safeJson(s: string, fallback: any) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export default router;
