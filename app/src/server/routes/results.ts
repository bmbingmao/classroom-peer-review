import { Router } from 'express';
import { all, one } from '../db.ts';
import { int } from '../util.ts';
import {
  activityItems,
  effectiveStatus,
  getActivityForStudent,
  getActivityForTeacher,
  invitedStudentIds,
} from '../lib.ts';
import { round2, trimmedMean, weightedTotal } from '../scoring.ts';

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

  const judgeLabel = new Map<number, string>();
  [...new Set(recs.map((r) => r.student_id))].forEach((id, i) => judgeLabel.set(id, `评委${i + 1}`));

  const bucket = new Map<string, { studentId: number; score: number }[]>();
  for (const r of recs) {
    const key = `${r.target_id}:${r.item_id}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push({ studentId: r.student_id, score: r.score });
  }

  const targetStats = targets.map((t) => {
    const perItem = items.map((it) => {
      const entries = bucket.get(`${t.id}:${it.id}`) ?? [];
      const r = trimmedMean(entries);
      return {
        itemId: it.id,
        n: r.n,
        k: r.k,
        mean: r.mean === null ? null : round2(r.mean),
        rawMean: r.rawMean === null ? null : round2(r.rawMean),
        // 默认只给匿名编号；真实姓名走 /activities/:id/identities（小眼睛）
        removedLow: r.removedLow.map((e) => ({ studentId: e.studentId, score: e.score, label: judgeLabel.get(e.studentId) })),
        removedHigh: r.removedHigh.map((e) => ({ studentId: e.studentId, score: e.score, label: judgeLabel.get(e.studentId) })),
      };
    });
    const total = weightedTotal(
      items.map((it, i) => ({ itemId: it.id, weight: it.weight, mean: perItem[i].mean })),
    );
    return {
      id: t.id,
      anon_label: t.anon_label,
      hidden: !!t.hidden,
      hasOwner: !!t.student_id,
      isMinePossible: false,
      total,
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
  });
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

  const stats = targets.map((t) => {
    const perItem = items.map((it) => {
      const r = trimmedMean((bucket.get(`${t.id}:${it.id}`) ?? []).map((s, i) => ({ studentId: i, score: s })));
      return { itemId: it.id, mean: r.mean === null ? null : round2(r.mean), n: r.n };
    });
    return {
      id: t.id,
      anon_label: t.anon_label,
      total: weightedTotal(items.map((it, i) => ({ itemId: it.id, weight: it.weight, mean: perItem[i].mean }))),
      items: perItem,
      // 只有作者本人且教师允许时才有值
      mine: a.allow_peek_own_result && t.student_id === me,
    };
  });

  res.json({ ...base, items, targets: stats, comments: commentsFor(a.id, false) });
});

/* ==================== helpers ==================== */

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
