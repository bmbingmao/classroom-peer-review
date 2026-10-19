import { Router } from 'express';
import { all, one, run, tx } from '../db.ts';
import { arr, bad, int, notFound, num, optStr, str, ts } from '../util.ts';
import { bumpVersion, effectiveStatus, getActivityForTeacher, invitedStudentIds } from '../lib.ts';

const router = Router();

/* ---------------- 列表 ---------------- */

router.get('/activities', (req: any, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const folder = req.query.folderId;

  let sql = 'SELECT * FROM activities WHERE teacher_id = ?';
  const params: unknown[] = [req.user.id];
  if (type === 'vote' || type === 'score') {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (folder === 'none') sql += ' AND folder_id IS NULL';
  else if (folder !== undefined && folder !== '') {
    sql += ' AND folder_id = ?';
    params.push(int(folder, 'folderId'));
  }
  if (q) {
    sql += ' AND title LIKE ?';
    params.push(`%${q}%`);
  }
  sql += ' ORDER BY id DESC LIMIT 300';

  const rows = all<any>(sql, ...params).map((a) => summarize(a));
  res.json({ activities: rows });
});

function summarize(a: any) {
  const invited = invitedStudentIds(a.id);
  let submitted = 0;
  if (a.type === 'vote') {
    submitted = one<{ c: number }>('SELECT COUNT(*) AS c FROM vote_ballots WHERE activity_id = ?', a.id)?.c ?? 0;
  } else {
    submitted =
      one<{ c: number }>('SELECT COUNT(*) AS c FROM score_submissions WHERE activity_id = ?', a.id)?.c ?? 0;
  }
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    folder_id: a.folder_id,
    anonymous: a.anonymous,
    start_at: a.start_at,
    end_at: a.end_at,
    status: a.status,
    effective: effectiveStatus(a),
    invitedCount: invited.size,
    submittedCount: submitted,
    created_at: a.created_at,
    version: a.version,
  };
}

/* ---------------- 详情（教师视角） ---------------- */

router.get('/activities/:id', (req: any, res) => {
  const a = getActivityForTeacher(int(req.params.id, 'id'), req.user.id);
  const groups = all<any>(
    `SELECT g.id, g.name FROM activity_groups ag JOIN groups g ON g.id = ag.group_id
      WHERE ag.activity_id = ? ORDER BY g.id`,
    a.id,
  );
  const base = { ...summarize(a), description: a.description, groups, allow_peek_own_result: a.allow_peek_own_result };

  if (a.type === 'vote') {
    const options = all<any>('SELECT id, text, image, sort FROM vote_options WHERE activity_id = ? ORDER BY sort, id', a.id);
    const ballotCount =
      one<{ c: number }>('SELECT COUNT(*) AS c FROM vote_ballots WHERE activity_id = ?', a.id)?.c ?? 0;
    return res.json({
      activity: { ...base, multiple: a.vote_multiple, maxChoices: a.vote_max_choices },
      options,
      ballotCount,
    });
  }

  const items = all<any>(
    'SELECT id, name, min_score, max_score, weight, sort FROM score_items WHERE activity_id = ? ORDER BY sort, id',
    a.id,
  );
  const targets = all<any>(
    `SELECT t.id, t.anon_label, t.media_json, t.hidden, t.sort, t.student_id,
            u.display_name AS student_name, u.username AS student_username
       FROM score_targets t LEFT JOIN users u ON u.id = t.student_id
      WHERE t.activity_id = ? ORDER BY t.sort, t.id`,
    a.id,
  );
  res.json({ activity: base, items, targets });
});

/* ---------------- 创建 ---------------- */

router.post('/activities', (req: any, res) => {
  const body = req.body ?? {};
  const type = body.type === 'vote' || body.type === 'score' ? body.type : null;
  if (!type) throw bad('type 必须是 vote 或 score');

  const title = str(body.title, '标题', 120);
  const description = optStr(body.description, '说明', 20000);
  const anonymous = body.anonymous === false ? 0 : 1;
  const allowPeek = body.allowPeekOwnResult === false ? 0 : 1;
  const startAt = ts(body.startAt ?? Date.now(), '开始时间');
  const endAt = ts(body.endAt, '截止时间');
  if (endAt <= startAt) throw bad('截止时间必须晚于开始时间');
  if (endAt - startAt > 365 * 86_400_000) throw bad('时间跨度太长');

  const folderId = body.folderId === undefined || body.folderId === null || body.folderId === '' ? null : int(body.folderId, '文件夹');
  if (folderId !== null) assertFolder(req.user.id, folderId);

  const groupIds = arr(body.groupIds ?? [], '参与组').map((g) => int(g, '参与组'));
  if (groupIds.length === 0) throw bad('至少要选择一个参与组');
  groupIds.forEach((gid) => assertGroup(req.user.id, gid));

  const id = tx(() => {
    const r = run(
      `INSERT INTO activities(teacher_id, type, title, description, folder_id, anonymous, allow_peek_own_result,
                              start_at, end_at, status, media_json, version, created_at)
       VALUES(?,?,?,?,?,?,?,?,?, 'open', '[]', 0, ?)`,
      req.user.id,
      type,
      title,
      description,
      folderId,
      anonymous,
      allowPeek,
      startAt,
      endAt,
      Date.now(),
    );
    const activityId = Number(r.lastInsertRowid);
    for (const gid of Array.from(new Set(groupIds))) {
      run('INSERT INTO activity_groups(activity_id, group_id) VALUES(?,?)', activityId, gid);
    }
    if (type === 'vote') createVote(activityId, body);
    else createScore(activityId, body, req.user.id);
    return activityId;
  });

  res.json({ id });
});

function createVote(activityId: number, body: any) {
  const options = arr(body.options ?? [], '投票选项');
  if (options.length < 2) throw bad('投票至少要有 2 个选项');
  if (options.length > 10) throw bad('投票选项最多 10 个');
  const multiple = body.multiple === true;
  const maxChoices = multiple ? int(body.maxChoices ?? options.length, '最多选几项', 1, options.length) : 1;
  options.forEach((opt: any, i: number) => {
    run(
      'INSERT INTO vote_options(activity_id, text, image, sort) VALUES(?,?,?,?)',
      activityId,
      str(opt?.text, `选项 ${i + 1} 文字`, 200),
      optStr(opt?.image, `选项 ${i + 1} 配图`, 500),
      i,
    );
  });
  run('UPDATE activities SET vote_multiple = ?, vote_max_choices = ? WHERE id = ?', multiple ? 1 : 0, maxChoices, activityId);
}

function createScore(activityId: number, body: any, teacherId: number) {
  const items = arr(body.items ?? [], '评分项');
  if (items.length < 1) throw bad('至少要有 1 个评分项');
  if (items.length > 20) throw bad('评分项最多 20 个');
  items.forEach((it: any, i: number) => {
    const min = int(it?.min ?? 1, `评分项 ${i + 1} 最低分`, -10000, 10000);
    const max = int(it?.max ?? 10, `评分项 ${i + 1} 最高分`, -10000, 10000);
    if (max <= min) throw bad(`评分项 ${i + 1} 的最高分必须大于最低分`);
    if (max - min > 1000) throw bad(`评分项 ${i + 1} 的分值跨度过大`);
    run(
      'INSERT INTO score_items(activity_id, name, min_score, max_score, weight, sort) VALUES(?,?,?,?,?,?)',
      activityId,
      str(it?.name, `评分项 ${i + 1} 名称`, 80),
      min,
      max,
      num(it?.weight ?? 1, `评分项 ${i + 1} 权重`, 0, 1_000_000),
      i,
    );
  });

  const targets = arr(body.targets ?? [], '被评对象');
  if (targets.length < 1) throw bad('至少要有 1 个被评对象');
  if (targets.length > 50) throw bad('被评对象最多 50 个');
  targets.forEach((t: any, i: number) => {
    let studentId: number | null = null;
    if (t?.studentId !== undefined && t?.studentId !== null && t?.studentId !== '') {
      studentId = int(t.studentId, `被评对象 ${i + 1} 关联学生`);
      const owned = one<any>(
        'SELECT 1 AS x FROM teacher_students WHERE teacher_id = ? AND student_id = ?',
        teacherId,
        studentId,
      );
      if (!owned) throw bad(`被评对象 ${i + 1} 关联的学生不在你的学生里`);
    }
    const label = optStr(t?.anonLabel, `被评对象 ${i + 1} 编号`, 40) || autoLabel(i);
    run(
      'INSERT INTO score_targets(activity_id, student_id, anon_label, media_json, hidden, sort) VALUES(?,?,?,?,?,?)',
      activityId,
      studentId,
      label,
      JSON.stringify(Array.isArray(t?.media) ? t.media : []),
      t?.hidden === true ? 1 : 0,
      i,
    );
  });
}

function autoLabel(i: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return i < 26 ? `作品${letters[i]}` : `作品${i + 1}`;
}

/* ---------------- 更新 / 删除 ---------------- */

router.patch('/activities/:id', (req: any, res) => {
  const a = getActivityForTeacher(int(req.params.id, 'id'), req.user.id);
  const body = req.body ?? {};
  const sets: string[] = [];
  const params: unknown[] = [];

  if (body.title !== undefined) {
    sets.push('title = ?');
    params.push(str(body.title, '标题', 120));
  }
  if (body.description !== undefined) {
    sets.push('description = ?');
    params.push(optStr(body.description, '说明', 20000));
  }
  if (body.endAt !== undefined) {
    const endAt = ts(body.endAt, '截止时间');
    if (endAt <= a.start_at) throw bad('截止时间必须晚于开始时间');
    sets.push('end_at = ?');
    params.push(endAt);
  }
  if (body.status !== undefined) {
    const status = str(body.status, 'status', 16);
    if (!['open', 'closed'].includes(status)) throw bad('status 只能是 open 或 closed');
    sets.push('status = ?');
    params.push(status);
  }
  if (body.folderId !== undefined) {
    const fid = body.folderId === null || body.folderId === '' ? null : int(body.folderId, '文件夹');
    if (fid !== null) assertFolder(req.user.id, fid);
    sets.push('folder_id = ?');
    params.push(fid);
  }
  if (body.allowPeekOwnResult !== undefined) {
    sets.push('allow_peek_own_result = ?');
    params.push(body.allowPeekOwnResult === false ? 0 : 1);
  }
  if (sets.length === 0) throw bad('没有要更新的字段');

  sets.push('version = version + 1');
  params.push(a.id);
  run(`UPDATE activities SET ${sets.join(', ')} WHERE id = ?`, ...params);
  res.json({ ok: true });
});

router.delete('/activities/:id', (req: any, res) => {
  const a = getActivityForTeacher(int(req.params.id, 'id'), req.user.id);
  run('DELETE FROM activities WHERE id = ?', a.id);
  res.json({ ok: true });
});

/* ---------------- helpers ---------------- */

function assertGroup(teacherId: number, groupId: number) {
  const g = one<any>('SELECT id FROM groups WHERE id = ? AND teacher_id = ?', groupId, teacherId);
  if (!g) throw bad('参与组不存在或不属于你');
}

function assertFolder(teacherId: number, folderId: number) {
  const f = one<any>('SELECT id FROM folders WHERE id = ? AND teacher_id = ?', folderId, teacherId);
  if (!f) throw notFound('文件夹不存在');
}

export default router;
