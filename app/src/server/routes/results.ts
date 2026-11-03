import { Router } from 'express';
import { all, one, run, tx } from '../db.ts';
import { bad, int, notFound } from '../util.ts';
import {
  activityItems,
  bumpVersion,
  effectiveStatus,
  getActivityForStudent,
  getActivityForTeacher,
  invitedStudentIds,
} from '../lib.ts';
import { blend, round2, trimmedMean, weightedTotal, type TrimSpec } from '../scoring.ts';

const teacherRouter = Router();
const studentRouter = Router();

/* ==================== 教师端结果 ==================== */

teacherRouter.get('/results/:id', (req: any, res) => {
  const a = getActivityForTeacher(int(req.params.id, 'id'), req.user.id);

  const invited = invitedStudentIds(a.id);
  const submitted = submittedIds(a);
  const absent = [...invited].filter((id) => !submitted.has(id));

  const common = {
    id: a.id,
    type: a.type,
    title: a.title,
    anonymous: !!a.anonymous,
    effective: effectiveStatus(a),
    start_at: a.start_at,
    end_at: a.end_at,
    version: a.version,
    invitedCount: invited.size,
    submittedCount: submitted.size,
    absentees: namesOf(absent),
  };

  if (a.type === 'vote') {
    const options = all<any>('SELECT id, text, image FROM vote_options WHERE activity_id = ? ORDER BY sort, id', a.id);
    const counts = new Map<number, number>(options.map((o) => [o.id, 0]));
    for (const b of all<any>('SELECT option_ids FROM vote_ballots WHERE activity_id = ?', a.id)) {
      const ids: number[] = safeJson(b.option_ids, []);
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const max = Math.max(0, ...counts.values());
    return res.json({
      ...common,
      multiple: !!a.vote_multiple,
      maxChoices: a.vote_max_choices,
      options: options.map((o) => ({
        id: o.id,
        text: o.text,
        image: o.image,
        count: counts.get(o.id) ?? 0,
        top: (counts.get(o.id) ?? 0) === max && max > 0, // 并列最高全部标记
      })),
      comments: commentsFor(a.id, true),
    });
  }

  const items = activityItems(a.id);
  const targets = all<any>(
    `SELECT t.id, t.anon_label, t.student_id, t.hidden
       FROM score_targets t WHERE t.activity_id = ? ORDER BY t.sort, t.id`,
    a.id,
  );
  const recs = all<any>(
    'SELECT target_id, item_id, student_id, score FROM score_records WHERE activity_id = ?',
    a.id,
  );
  const ctx = scoringContext(a);

  const judgeLabel = new Map<number, string>();
  [...new Set(recs.map((r) => r.student_id))].forEach((id, i) => judgeLabel.set(id, `评委${i + 1}`));

  const bucket = new Map<string, { studentId: number; score: number }[]>();
  for (const r of recs) {
    const key = `${r.target_id}:${r.item_id}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push({ studentId: r.student_id, score: r.score });
  }

  let teacherScoredCount = 0;
  const targetStats = targets.map((t) => {
    const perItem = items.map((it) => {
      const entries = bucket.get(`${t.id}:${it.id}`) ?? [];
      const r = trimmedMean(entries, ctx.trim);
      const teacher = ctx.teacher.get(`${t.id}:${it.id}`) ?? null;
      if (teacher !== null) teacherScoredCount += 1;
      return {
        itemId: it.id,
        n: r.n,
        k: r.low,
        low: r.low,
        high: r.high,
        auto: r.auto,
        mean: r.mean === null ? null : round2(r.mean),
        rawMean: r.rawMean === null ? null : round2(r.rawMean),
        teacher: teacher === null ? null : round2(teacher),
        combined: fmt(blend(teacher, r.mean, ctx.weight)),
        // 默认只给匿名编号；真实姓名走 /activities/:id/identities（小眼睛）
        removedLow: r.removedLow.map((e) => ({ studentId: e.studentId, score: e.score, label: judgeLabel.get(e.studentId) })),
        removedHigh: r.removedHigh.map((e) => ({ studentId: e.studentId, score: e.score, label: judgeLabel.get(e.studentId) })),
      };
    });
    const studentTotal = weightedTotal(items.map((it, i) => ({ itemId: it.id, weight: it.weight, mean: perItem[i].mean })));
    const teacherTotal = weightedTotal(
      items.map((it, i) => ({ itemId: it.id, weight: it.weight, mean: perItem[i].teacher })),
    );
    const total = weightedTotal(items.map((it, i) => ({ itemId: it.id, weight: it.weight, mean: perItem[i].combined })));
    return {
      id: t.id,
      anon_label: t.anon_label,
      hidden: !!t.hidden,
      hasOwner: !!t.student_id,
      isMinePossible: false,
      total,
      studentTotal,
      teacherTotal,
      teacherScored: perItem.some((x) => x.teacher !== null),
      items: perItem,
    };
  });

  res.json({
    ...common,
    items,
    targets: targetStats,
    judgeCount: judgeLabel.size,
    pendingComments: pendingCount(a.id),
    comments: commentsFor(a.id, true),
    scoring: {
      teacherWeight: ctx.weight,
      trimLow: ctx.trim ? ctx.trim.low : null,
      trimHigh: ctx.trim ? ctx.trim.high : null,
      auto: ctx.trim === null,
      teacherScoredCount,
    },
  });
});

/* ==================== 教师打分 / 计分设置 ==================== */

teacherRouter.put('/activities/:id/teacher-scores', (req: any, res) => {
  const a = getActivityForTeacher(int(req.params.id, 'id'), req.user.id);
  if (a.type !== 'score') throw bad('只有评分类活动可以教师打分');

  const targetId = int(req.body?.targetId, '被评对象');
  const t = one<any>('SELECT id FROM score_targets WHERE id = ? AND activity_id = ?', targetId, a.id);
  if (!t) throw notFound('被评对象不存在');

  const items = activityItems(a.id);
  const meta = new Map(items.map((i) => [i.id, i]));
  const rows = Array.isArray(req.body?.scores) ? req.body.scores : [];
  if (rows.length > items.length) throw bad('打分数超过评分项数量');

  tx(() => {
    run('DELETE FROM teacher_scores WHERE target_id = ?', targetId);
    const seen = new Set<number>();
    for (const s of rows) {
      const itemId = int(s?.itemId, '评分项');
      const it = meta.get(itemId);
      if (!it) throw bad('评分项不属于本次评价');
      if (seen.has(itemId)) throw bad('同一个评分项只能打一次分');
      seen.add(itemId);
      const score = int(s?.score, '分数', it.min_score, it.max_score);
      run(
        'INSERT INTO teacher_scores(activity_id, target_id, item_id, score, updated_at) VALUES(?,?,?,?,?)',
        a.id,
        targetId,
        itemId,
        score,
        Date.now(),
      );
    }
  });

  bumpVersion(a.id);
  res.json({ ok: true, scored: rows.length });
});

teacherRouter.patch('/activities/:id/scoring-settings', (req: any, res) => {
  const a = getActivityForTeacher(int(req.params.id, 'id'), req.user.id);
  const body = req.body ?? {};
  const sets: string[] = [];
  const params: unknown[] = [];

  if (body.teacherWeight !== undefined) {
    sets.push('teacher_weight = ?');
    params.push(int(body.teacherWeight, '教师权重', 0, 100));
  }
  if (body.auto === true) {
    sets.push('trim_low = NULL', 'trim_high = NULL');
  } else if (body.trimLow !== undefined || body.trimHigh !== undefined) {
    sets.push('trim_low = ?', 'trim_high = ?');
    params.push(int(body.trimLow ?? 0, '低值剔除个数', 0, 50), int(body.trimHigh ?? 0, '高值剔除个数', 0, 50));
  }
  if (sets.length === 0) throw bad('没有要更新的设置');

  sets.push('version = version + 1');
  params.push(a.id);
  run(`UPDATE activities SET ${sets.join(', ')} WHERE id = ?`, ...params);
  res.json({ ok: true });
});

/* ==================== 学生端结果（匿名） ==================== */

studentRouter.get('/results/:id', (req: any, res) => {
  const a = getActivityForStudent(int(req.params.id, 'id'), req.user.id);
  const me = req.user.id;

  const base = {
    id: a.id,
    title: a.title,
    type: a.type,
    anonymous: !!a.anonymous,
    effective: effectiveStatus(a),
    end_at: a.end_at,
    version: a.version,
  };

  if (a.type === 'vote') {
    const options = all<any>('SELECT id, text FROM vote_options WHERE activity_id = ? ORDER BY sort, id', a.id);
    const counts = new Map<number, number>(options.map((o) => [o.id, 0]));
    for (const b of all<any>('SELECT option_ids FROM vote_ballots WHERE activity_id = ?', a.id)) {
      for (const id of safeJson(b.option_ids, [])) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const max = Math.max(0, ...counts.values());
    return res.json({
      ...base,
      options: options.map((o) => ({
        id: o.id,
        text: o.text,
        count: counts.get(o.id) ?? 0,
        top: (counts.get(o.id) ?? 0) === max && max > 0,
      })),
      comments: commentsFor(a.id, false),
    });
  }

  const items = activityItems(a.id).map((i) => ({ id: i.id, name: i.name, weight: i.weight }));
  const targets = all<any>(
    "SELECT id, anon_label, student_id FROM score_targets WHERE activity_id = ? AND hidden = 0 ORDER BY sort, id",
    a.id,
  );
  const recs = all<any>('SELECT target_id, item_id, score FROM score_records WHERE activity_id = ?', a.id);
  const bucket = new Map<string, number[]>();
  for (const r of recs) {
    const key = `${r.target_id}:${r.item_id}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push(r.score);
  }
  const ctx = scoringContext(a);

  const stats = targets.map((t) => {
    const perItem = items.map((it) => {
      const r = trimmedMean(
        (bucket.get(`${t.id}:${it.id}`) ?? []).map((s, i) => ({ studentId: i, score: s })),
        ctx.trim,
      );
      const teacher = ctx.teacher.get(`${t.id}:${it.id}`) ?? null;
      return {
        itemId: it.id,
        mean: r.mean === null ? null : round2(r.mean),
        n: r.n,
        combined: fmt(blend(teacher, r.mean, ctx.weight)),
      };
    });
    return {
      id: t.id,
      anon_label: t.anon_label,
      total: weightedTotal(items.map((it, i) => ({ itemId: it.id, weight: it.weight, mean: perItem[i].combined }))),
      items: perItem,
      // 只有作者本人且教师允许时才有值
      mine: a.allow_peek_own_result && t.student_id === me,
    };
  });

  res.json({
    ...base,
    items,
    targets: stats,
    comments: commentsFor(a.id, false),
    teacherWeight: ctx.weight,
    hasTeacherScores: ctx.teacher.size > 0,
  });
});

/* ==================== helpers ==================== */

/** 教师权重 / 两端剔除数 / 教师本人打分，教师端与学生端共用同一套口径 */
function scoringContext(a: any): { weight: number; trim: TrimSpec | null; teacher: Map<string, number> } {
  const weight = a.teacher_weight === null || a.teacher_weight === undefined ? 60 : Number(a.teacher_weight);
  const manual =
    (a.trim_low !== null && a.trim_low !== undefined) || (a.trim_high !== null && a.trim_high !== undefined);
  const trim: TrimSpec | null = manual ? { low: Number(a.trim_low ?? 0), high: Number(a.trim_high ?? 0) } : null;
  const teacher = new Map<string, number>();
  for (const r of all<any>('SELECT target_id, item_id, score FROM teacher_scores WHERE activity_id = ?', a.id)) {
    teacher.set(`${r.target_id}:${r.item_id}`, r.score);
  }
  return { weight, trim, teacher };
}

function fmt(x: number | null): number | null {
  return x === null ? null : round2(x);
}

function pendingCount(activityId: number): number {
  return one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM comments WHERE activity_id = ? AND moderation_status = 'pending'",
    activityId,
  )?.c ?? 0;
}

function submittedIds(a: any): Set<number> {
  const rows =
    a.type === 'vote'
      ? all<{ student_id: number }>('SELECT student_id FROM vote_ballots WHERE activity_id = ?', a.id)
      : all<{ student_id: number }>('SELECT student_id FROM score_submissions WHERE activity_id = ?', a.id);
  return new Set(rows.map((r) => r.student_id));
}

function nameOf(id: number): string {
  const u = one<any>('SELECT display_name, username FROM users WHERE id = ?', id);
  return u ? `${u.display_name}(${u.username})` : `#${id}`;
}

function namesOf(ids: number[]) {
  if (ids.length === 0) return [];
  const rows = all<any>(
    `SELECT id, display_name, username FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  return rows.map((r) => ({ id: r.id, display_name: r.display_name, username: r.username }));
}

function commentsFor(activityId: number, teacherView: boolean) {
  const sql = teacherView
    ? 'SELECT * FROM comments WHERE activity_id = ? ORDER BY id DESC LIMIT 500'
    : "SELECT id, target_id, content, created_at, folded FROM comments WHERE activity_id = ? AND moderation_status = 'approved' AND folded = 0 ORDER BY id DESC LIMIT 200";
  const rows = all<any>(sql, activityId);
  if (!teacherView) return rows;
  return rows.map((c) => ({ ...c, author: nameOf(c.student_id) }));
}

function safeJson(s: string, fallback: any) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export { teacherRouter, studentRouter };
