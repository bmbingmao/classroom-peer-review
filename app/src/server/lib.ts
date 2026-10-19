import { all, one, run } from './db.ts';
import { HttpError, forbidden, notFound } from './util.ts';

export type Activity = {
  id: number;
  teacher_id: number;
  type: 'vote' | 'score';
  title: string;
  description: string;
  folder_id: number | null;
  anonymous: number;
  allow_peek_own_result: number;
  start_at: number;
  end_at: number;
  status: 'draft' | 'open' | 'closed';
  media_json: string;
  vote_multiple: number;
  vote_max_choices: number;
  version: number;
  created_at: number;
};

/**
 * 有效状态由服务端派生，不依赖前端，也不需要定时任务：
 *   closed(教师手动关闭) > 未到开始时间 pending > 已过截止 ended > open
 */
export function effectiveStatus(a: Activity, at = Date.now()): 'pending' | 'open' | 'ended' | 'closed' {
  if (a.status === 'closed') return 'closed';
  if (a.status === 'draft') return 'pending';
  if (at < a.start_at) return 'pending';
  if (at > a.end_at) return 'ended';
  return 'open';
}

export function isAcceptingAnswers(a: Activity, at = Date.now()): boolean {
  return effectiveStatus(a, at) === 'open';
}

/** 不在开放期就抛出可读错误 */
export function activeOrThrow(a: Activity) {
  const s = effectiveStatus(a);
  if (s === 'pending') throw new HttpError(400, 'not_started', '还没到开始时间');
  if (s === 'ended') throw new HttpError(400, 'ended', '已过截止时间，不能再提交');
  if (s === 'closed') throw new HttpError(400, 'closed', '教师已关闭本活动');
}

export function getActivityForTeacher(id: number, teacherId: number): Activity {
  const a = one<Activity>('SELECT * FROM activities WHERE id = ?', id);
  if (!a) throw notFound('评价项不存在');
  if (a.teacher_id !== teacherId) throw forbidden();
  return a;
}

export function getActivityForStudent(id: number, studentId: number): Activity {
  const a = one<Activity>('SELECT * FROM activities WHERE id = ?', id);
  if (!a) throw notFound('评价项不存在');
  if (!studentInvited(id, studentId)) throw forbidden('你不在本次评价的参与范围内');
  return a;
}

/** 活动邀请到的组 */
export function activityGroupIds(activityId: number): number[] {
  return all<{ group_id: number }>('SELECT group_id FROM activity_groups WHERE activity_id = ?', activityId).map(
    (r) => r.group_id,
  );
}

/** 活动邀请的学生集合（去重） */
export function invitedStudentIds(activityId: number): Set<number> {
  const rows = all<{ student_id: number }>(
    `SELECT DISTINCT gm.student_id
       FROM activity_groups ag
       JOIN group_members gm ON gm.group_id = ag.group_id
      WHERE ag.activity_id = ?`,
    activityId,
  );
  return new Set(rows.map((r) => r.student_id));
}

export function studentInvited(activityId: number, studentId: number): boolean {
  const row = one<{ c: number }>(
    `SELECT COUNT(*) AS c
       FROM activity_groups ag
       JOIN group_members gm ON gm.group_id = ag.group_id
      WHERE ag.activity_id = ? AND gm.student_id = ?`,
    activityId,
    studentId,
  );
  return (row?.c ?? 0) > 0;
}

/** 该学生本次应评的被评对象（排除 hidden 和"自己的作品"） */
export function expectedTargets(activityId: number, studentId: number) {
  return all<{ id: number; anon_label: string; media_json: string; sort: number }>(
    `SELECT id, anon_label, media_json, sort
       FROM score_targets
      WHERE activity_id = ? AND hidden = 0
        AND (student_id IS NULL OR student_id <> ?)
      ORDER BY sort, id`,
    activityId,
    studentId,
  );
}

export function activityItems(activityId: number) {
  return all<{ id: number; name: string; min_score: number; max_score: number; weight: number; sort: number }>(
    'SELECT id, name, min_score, max_score, weight, sort FROM score_items WHERE activity_id = ? ORDER BY sort, id',
    activityId,
  );
}

export function bumpVersion(activityId: number) {
  run('UPDATE activities SET version = version + 1 WHERE id = ?', activityId);
}

export function assertHttp(err: unknown): never {
  if (err instanceof HttpError) throw err;
  throw new HttpError(500, 'internal', (err as Error)?.message ?? '服务器错误');
}
