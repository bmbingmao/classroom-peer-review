import { Router } from 'express';
import { all, one, run } from '../db.ts';
import { bad, int, notFound, optStr, str } from '../util.ts';
import { POINTS, changePoints, pointsOf } from '../points.ts';

export const teacherPoints = Router();
export const studentPoints = Router();

/* ==================== 教师端 ==================== */

/** 排行榜：可按班级（组）或按课程（文件夹）看 */
teacherPoints.get('/points/leaderboard', (req: any, res) => {
  const groupId = req.query.groupId ? int(req.query.groupId, 'groupId') : null;
  const folderId = req.query.folderId ? int(req.query.folderId, 'folderId') : null;
  res.json({ rows: leaderboard(req.user.id, groupId, folderId), groupId, folderId });
});

teacherPoints.get('/points/groups', (req: any, res) => {
  res.json({ groups: all('SELECT id, name FROM groups WHERE teacher_id = ? ORDER BY id', req.user.id) });
});

/** 流水 */
teacherPoints.get('/points/ledger', (req: any, res) => {
  const studentId = req.query.studentId ? int(req.query.studentId, 'studentId') : null;
  const own = one<any>('SELECT 1 AS x FROM teacher_students WHERE teacher_id = ? AND student_id = ?', req.user.id, studentId);
  if (studentId && !own) throw bad('该学生不属于你');
  const rows = studentId
    ? all<any>(
        `SELECT l.*, a.title AS activity_title FROM point_ledger l
           LEFT JOIN activities a ON a.id = l.activity_id
          WHERE l.student_id = ? ORDER BY l.id DESC LIMIT 200`,
        studentId,
      )
    : all<any>(
        `SELECT l.*, u.display_name, u.username, a.title AS activity_title FROM point_ledger l
           JOIN users u ON u.id = l.student_id
           LEFT JOIN activities a ON a.id = l.activity_id
          WHERE u.id IN (SELECT student_id FROM teacher_students WHERE teacher_id = ?)
          ORDER BY l.id DESC LIMIT 200`,
        req.user.id,
      );
  res.json({ ledger: rows });
});

/** 手动加/减分（必须写原因） */
teacherPoints.post('/points/adjust', (req: any, res) => {
  const studentId = int(req.body?.studentId, 'studentId');
  const delta = int(req.body?.delta, 'delta', -1000, 1000);
  const reason = str(req.body?.reason, '原因', 200);
  if (delta === 0) throw bad('加减分不能为 0');
  const own = one<any>('SELECT 1 AS x FROM teacher_students WHERE teacher_id = ? AND student_id = ?', req.user.id, studentId);
  if (!own) throw bad('该学生不属于你');
  const actual = changePoints(studentId, delta, `manual:${reason}`, { operatorId: req.user.id });
  res.json({ ok: true, actual, points: pointsOf(studentId) });
});

/* ==================== 学生端 ==================== */

studentPoints.get('/points', (req: any, res) => {
  const rows = all<any>(
    `SELECT l.*, a.title AS activity_title FROM point_ledger l
       LEFT JOIN activities a ON a.id = l.activity_id
      WHERE l.student_id = ? ORDER BY l.id DESC LIMIT 100`,
    req.user.id,
  );
  res.json({
    points: pointsOf(req.user.id),          // 当前余额（可能被消费扣成负的）
    earned: earnedOf(req.user.id),          // 历史累计获得（只加不减）
    spent: spentOf(req.user.id),            // 历史累计消费（正数）
    ledger: rows,
    rules: POINTS,
  });
});

studentPoints.get('/points/leaderboard', (req: any, res) => {
  const groupId = req.query.groupId ? int(req.query.groupId, 'groupId') : null;
  const mine = all<{ group_id: number }>('SELECT group_id FROM group_members WHERE student_id = ?', req.user.id);
  if (mine.length === 0) return res.json({ rows: [], myRank: null });
  const gid = groupId ?? mine[0].group_id;
  const allowed = mine.some((m) => m.group_id === gid);
  if (!allowed) throw bad('你不在这个班里');
  const rows = all<any>(
    `SELECT u.id, u.display_name, u.points_cached AS points
       FROM group_members m JOIN users u ON u.id = m.student_id
      WHERE m.group_id = ? ORDER BY u.points_cached DESC, u.username`,
    gid,
  );
  const myRank = rows.findIndex((r) => r.id === req.user.id) + 1;
  res.json({
    rows: rows.map((r, i) => ({ ...r, rank: i + 1, isMe: r.id === req.user.id })),
    myRank: myRank || null,
  });
});

/* ==================== helpers ==================== */

/** 历史累计获得的积分（只看正数流水） */
export function earnedOf(studentId: number): number {
  const r = one<{ v: number | null }>('SELECT SUM(delta) AS v FROM point_ledger WHERE student_id = ? AND delta > 0', studentId);
  return r?.v ?? 0;
}

/** 历史累计消费（返回正数） */
export function spentOf(studentId: number): number {
  const r = one<{ v: number | null }>('SELECT SUM(delta) AS v FROM point_ledger WHERE student_id = ? AND delta < 0', studentId);
  return Math.abs(r?.v ?? 0);
}

function leaderboard(teacherId: number, groupId: number | null, folderId: number | null) {
  // earned：该学生历史累计获得（只看正数流水）；按文件夹看时只算这个文件夹
  const earnedSql = folderId
    ? 'COALESCE(SUM(CASE WHEN l.delta > 0 THEN l.delta ELSE 0 END), 0)'
    : '(SELECT COALESCE(SUM(delta), 0) FROM point_ledger WHERE student_id = u.id AND delta > 0)';
  const base = all<any>(
    `SELECT u.id, u.username, u.display_name,
            ${folderId ? 'COALESCE(SUM(l.delta), 0)' : 'u.points_cached'} AS points,
            ${earnedSql} AS earned
       FROM teacher_students t
       JOIN users u ON u.id = t.student_id
       ${folderId ? 'LEFT JOIN point_ledger l ON l.student_id = u.id AND l.folder_id = ?' : ''}
      WHERE t.teacher_id = ?
        ${groupId ? 'AND u.id IN (SELECT student_id FROM group_members WHERE group_id = ?)' : ''}
      GROUP BY u.id
      ORDER BY points DESC, u.username`,
    ...(folderId ? [folderId] : []),
    teacherId,
    ...(groupId ? [groupId] : []),
  );
  return base.map((r, i) => ({ ...r, rank: i + 1 }));
}
