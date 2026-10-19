import { Router } from 'express';
import { all, one, run, tx } from '../db.ts';
import { arr, bad, int, jsonParse, optStr } from '../util.ts';
import {
  activeOrThrow,
  activityItems,
  bumpVersion,
  effectiveStatus,
  expectedTargets,
  getActivityForStudent,
  isAcceptingAnswers,
} from '../lib.ts';
import { awardParticipation as awardPart } from '../points.ts';
import { enqueueComment } from '../ai-worker.ts';

const router = Router();

/* ---------------- 我的活动列表 ---------------- */

router.get('/activities', (req: any, res) => {
  const me = req.user.id;
  const rows = all<any>(
    `SELECT DISTINCT a.*
       FROM activities a
       JOIN activity_groups ag ON ag.activity_id = a.id
       JOIN group_members gm ON gm.group_id = ag.group_id
      LEFT JOIN folders f ON f.id = a.folder_id
      WHERE gm.student_id = ? AND COALESCE(f.archived, 0) = 0
      ORDER BY a.end_at DESC LIMIT 200`,
    me,
  );

  const out = rows.map((a) => {
    const participated =
      a.type === 'vote'
        ? !!one<any>('SELECT 1 AS x FROM vote_ballots WHERE activity_id = ? AND student_id = ?', a.id, me)
        : !!one<any>('SELECT 1 AS x FROM score_submissions WHERE activity_id = ? AND student_id = ?', a.id, me);
    return {
      id: a.id,
      type: a.type,
      title: a.title,
      anonymous: a.anonymous,
      start_at: a.start_at,
      end_at: a.end_at,
      effective: effectiveStatus(a),
      participated,
    };
  });

  res.json({ activities: out });
});

/* ---------------- 活动详情（学生视角：无真实身份） ---------------- */

router.get('/activities/:id', (req: any, res) => {
  const a = getActivityForStudent(int(req.params.id, 'id'), req.user.id);
  const me = req.user.id;

  const base = {
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description,
    anonymous: a.anonymous,
    start_at: a.start_at,
    end_at: a.end_at,
    effective: effectiveStatus(a),
    accepting: isAcceptingAnswers(a),
  };

  if (a.type === 'vote') {
    const options = all<any>('SELECT id, text, image, sort FROM vote_options WHERE activity_id = ? ORDER BY sort, id', a.id);
    const mine = one<any>('SELECT option_ids, updated_at FROM vote_ballots WHERE activity_id = ? AND student_id = ?', a.id, me);
    const myComment = one<any>(
      'SELECT content, moderation_status FROM comments WHERE activity_id = ? AND student_id = ? AND target_id IS NULL',
      a.id,
      me,
    );
    return res.json({
      activity: base,
      options,
      multiple: !!a.vote_multiple,
      maxChoices: a.vote_max_choices,
      myOptionIds: mine ? jsonParse<number[]>(mine.option_ids, []) : [],
      participated: !!mine,
      myComment: myComment?.content ?? '',
      myCommentStatus: myComment?.moderation_status ?? null,
    });
  }

  const items = activityItems(a.id).map((i) => ({ id: i.id, name: i.name, min_score: i.min_score, max_score: i.max_score }));
  const targets = expectedTargets(a.id, me).map((t) => ({
    id: t.id,
    anon_label: t.anon_label,
    media: jsonParse<any[]>(t.media_json, []),
  }));
  const draft = one<any>('SELECT payload, updated_at FROM score_drafts WHERE activity_id = ? AND student_id = ?', a.id, me);
  const submitted = !!one<any>(
    'SELECT 1 AS x FROM score_submissions WHERE activity_id = ? AND student_id = ?',
    a.id,
    me,
  );
  const myScores = submitted
    ? all<any>(
        'SELECT target_id, item_id, score FROM score_records WHERE activity_id = ? AND student_id = ?',
        a.id,
        me,
      )
    : [];

  const myComments = all<any>(
    'SELECT id, target_id, content, moderation_status FROM comments WHERE activity_id = ? AND student_id = ?',
    a.id,
    me,
  );

  res.json({
    activity: base,
    items,
    targets,
    submitted,
    myComments,
    draft: draft ? jsonParse<any>(draft.payload, {}) : null,
    myScores,
    // 本人是否为某个被评对象的作者（决定能否看自己作品成绩）
    ownsTarget: all<any>(
      "SELECT id FROM score_targets WHERE activity_id = ? AND student_id = ? AND hidden = 0",
      a.id,
      me,
    ).map((t) => t.id),
  });
});

/* ---------------- 投票提交 ---------------- */

router.post('/activities/:id/vote', (req: any, res) => {
  const a = getActivityForStudent(int(req.params.id, 'id'), req.user.id);
  if (a.type !== 'vote') throw bad('这不是投票活动');
  activeOrThrow(a);
  const me = req.user.id;

  const raw = arr(req.body?.optionIds ?? [], '选项');
  const optionIds = Array.from(new Set(raw.map((v) => int(v, '选项'))));
  if (optionIds.length === 0) throw bad('至少要选 1 项');

  const valid = all<any>('SELECT id FROM vote_options WHERE activity_id = ?', a.id).map((o) => o.id);
  for (const id of optionIds) {
    if (!valid.includes(id)) throw bad('包含无效选项');
  }
  const maxChoices = a.vote_multiple ? a.vote_max_choices : 1;
  if (optionIds.length > maxChoices) throw bad(`最多只能选 ${maxChoices} 项`);

  const comment = optStr(req.body?.comment, '评语', 2000);
  let newCommentId = 0;

  tx(() => {
    run(
      `INSERT INTO vote_ballots(activity_id, student_id, option_ids, updated_at) VALUES(?,?,?,?)
       ON CONFLICT(activity_id, student_id) DO UPDATE SET option_ids = excluded.option_ids, updated_at = excluded.updated_at`,
      a.id,
      me,
      JSON.stringify(optionIds),
      Date.now(),
    );
    if (comment) {
      newCommentId = upsertComment(a.id, null, me, comment);
    }
    awardParticipation(me, a, me);
    bumpVersion(a.id);
  });

  if (newCommentId) enqueueComment(newCommentId);

  res.json({ ok: true });
});

/* ---------------- 评分：草稿 ---------------- */

router.get('/activities/:id/draft', (req: any, res) => {
  const a = getActivityForStudent(int(req.params.id, 'id'), req.user.id);
  const d = one<any>('SELECT payload, updated_at FROM score_drafts WHERE activity_id = ? AND student_id = ?', a.id, req.user.id);
  res.json({ draft: d ? jsonParse<any>(d.payload, {}) : null, updated_at: d?.updated_at ?? null });
});

router.put('/activities/:id/draft', (req: any, res) => {
  const a = getActivityForStudent(int(req.params.id, 'id'), req.user.id);
  if (a.type !== 'score') throw bad('这不是评分活动');
  if (!isAcceptingAnswers(a)) throw bad('当前不在可填写时间内');
  const payload = req.body?.payload;
  if (payload === undefined) throw bad('缺少 payload');
  run(
    `INSERT INTO score_drafts(activity_id, student_id, payload, updated_at) VALUES(?,?,?,?)
     ON CONFLICT(activity_id, student_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    a.id,
    req.user.id,
    JSON.stringify(payload).slice(0, 500_000),
    Date.now(),
  );
  res.json({ ok: true });
});

/* ---------------- 评分：提交（必须打满） ---------------- */

router.post('/activities/:id/submit', (req: any, res) => {
  const a = getActivityForStudent(int(req.params.id, 'id'), req.user.id);
  if (a.type !== 'score') throw bad('这不是评分活动');
  activeOrThrow(a);
  const me = req.user.id;

  const targets = expectedTargets(a.id, me);
  const items = activityItems(a.id);
  const expected = new Map<string, { min: number; max: number }>();
  for (const t of targets) {
    for (const it of items) expected.set(`${t.id}:${it.id}`, { min: it.min_score, max: it.max_score });
  }

  const raw = arr(req.body?.scores ?? [], '评分');
  const given = new Map<string, number>();
  for (const row of raw) {
    const targetId = int(row?.targetId, 'targetId');
    const itemId = int(row?.itemId, 'itemId');
    const score = int(row?.score, '分数');
    const key = `${targetId}:${itemId}`;
    const range = expected.get(key);
    if (!range) throw bad('提交了不该评的对象或项目');
    if (score < range.min || score > range.max) throw bad(`分数 ${score} 超出范围 ${range.min}~${range.max}`);
    given.set(key, score);
  }

  const missing: { targetId: number; itemId: number }[] = [];
  for (const t of targets) {
    for (const it of items) {
      if (!given.has(`${t.id}:${it.id}`)) missing.push({ targetId: t.id, itemId: it.id });
    }
  }
  if (missing.length > 0) {
    throw bad(`还有 ${missing.length} 格没打分，必须打满才能提交`, { missing });
  }

  // 评语：支持单条（兼容旧调用）或多对象多条
  const pendingComments: { targetId: number | null; content: string }[] = [];
  if (Array.isArray(req.body?.comments)) {
    for (const item of req.body.comments) {
      const content = optStr(item?.content, '评语', 2000);
      if (!content) continue;
      const targetId = item?.targetId == null ? null : int(item.targetId, 'targetId');
      if (targetId !== null && !targets.some((t) => t.id === targetId)) throw bad('评语对应的被评对象不在本次评分范围内');
      if (pendingComments.length >= 50) throw bad('评语条数过多');
      pendingComments.push({ targetId, content });
    }
  } else {
    const content = optStr(req.body?.comment, '评语', 2000);
    if (content) {
      const targetId = req.body?.commentTargetId == null ? null : int(req.body.commentTargetId, 'commentTargetId');
      pendingComments.push({ targetId, content });
    }
  }
  const newCommentIds: number[] = [];

  tx(() => {
    run('DELETE FROM score_records WHERE activity_id = ? AND student_id = ?', a.id, me);
    for (const [key, score] of given) {
      const [targetId, itemId] = key.split(':').map(Number);
      run(
        'INSERT INTO score_records(activity_id, target_id, item_id, student_id, score, updated_at) VALUES(?,?,?,?,?,?)',
        a.id,
        targetId,
        itemId,
        me,
        score,
        Date.now(),
      );
    }
    run(
      `INSERT INTO score_submissions(activity_id, student_id, submitted_at) VALUES(?,?,?)
       ON CONFLICT(activity_id, student_id) DO UPDATE SET submitted_at = excluded.submitted_at`,
      a.id,
      me,
      Date.now(),
    );
    run('DELETE FROM score_drafts WHERE activity_id = ? AND student_id = ?', a.id, me);
    for (const pc of pendingComments) {
      newCommentIds.push(upsertComment(a.id, pc.targetId, me, pc.content));
    }
    awardParticipation(me, a, me);
    bumpVersion(a.id);
  });

  for (const cid of newCommentIds) enqueueComment(cid);
  res.json({ ok: true, comments: newCommentIds.length });
});

/* ---------------- helpers ---------------- */


/** 同一评委对同一对象只保留一条评语：修改就覆盖，并重新走审核 */
function upsertComment(activityId: number, targetId: number | null, studentId: number, content: string): number {
  const existing = one<any>(
    'SELECT id FROM comments WHERE activity_id = ? AND student_id = ? AND target_id IS ?',
    activityId,
    studentId,
    targetId,
  );
  if (existing) {
    run(
      "UPDATE comments SET content = ?, moderation_status = 'pending', ai_category = '', reject_reason = '', folded = 0, created_at = ? WHERE id = ?",
      content,
      Date.now(),
      existing.id,
    );
    return existing.id;
  }
  const r = run(
    `INSERT INTO comments(activity_id, target_id, student_id, content, moderation_status, created_at)
     VALUES(?,?,?,?, 'pending', ?)`,
    activityId,
    targetId,
    studentId,
    content,
    Date.now(),
  );
  return Number(r.lastInsertRowid);
}

/** 参与 +10，硬性只发一次（逻辑在 points.ts） */
function awardParticipation(studentId: number, a: any, _me: number) {
  return awardPart(studentId, a, primaryGroupId(a.id, studentId));
}

function primaryGroupId(activityId: number, studentId: number): number | null {
  const row = one<any>(
    `SELECT gm.group_id FROM activity_groups ag
       JOIN group_members gm ON gm.group_id = ag.group_id
      WHERE ag.activity_id = ? AND gm.student_id = ? LIMIT 1`,
    activityId,
    studentId,
  );
  return row?.group_id ?? null;
}

export default router;
