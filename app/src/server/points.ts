import { one, run } from './db.ts';

export const POINTS = {
  participate: 10,
  reactionCost: 5,
  positiveReceived: 1,
};

export type Scope = {
  activityId?: number | null;
  folderId?: number | null;
  groupId?: number | null;
  operatorId?: number | null;
};

/**
 * 记账 + 同步缓存。**积分允许为负**（老师可以扣到负数），
 * 但负分时不能使用任何消耗积分的功能（比如发表情）。
 * 返回实际变动量。
 */
export function changePoints(studentId: number, delta: number, reason: string, scope: Scope = {}): number {
  const row = one<{ points_cached: number }>('SELECT points_cached FROM users WHERE id = ?', studentId);
  if (!row) return 0;
  const next = row.points_cached + delta;
  const actual = next - row.points_cached;
  if (actual === 0) return 0;
  run('UPDATE users SET points_cached = ? WHERE id = ?', next, studentId);
  run(
    `INSERT INTO point_ledger(student_id, delta, reason, activity_id, folder_id, group_id, operator_id, created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
    studentId,
    actual,
    reason,
    scope.activityId ?? null,
    scope.folderId ?? null,
    scope.groupId ?? null,
    scope.operatorId ?? null,
    Date.now(),
  );
  return actual;
}

export function pointsOf(studentId: number): number {
  return one<{ points_cached: number }>('SELECT points_cached FROM users WHERE id = ?', studentId)?.points_cached ?? 0;
}

/** 参与分：靠 point_ledger 上的部分唯一索引保证每个活动只发一次 */
export function awardParticipation(studentId: number, a: any, groupId: number | null): boolean {
  const r = run(
    `INSERT OR IGNORE INTO point_ledger(student_id, delta, reason, activity_id, folder_id, group_id, created_at)
     VALUES(?, 10, 'participate', ?, ?, ?, ?)`,
    studentId,
    a.id,
    a.folder_id ?? null,
    groupId,
    Date.now(),
  );
  if (Number(r.changes) > 0) {
    run('UPDATE users SET points_cached = points_cached + 10 WHERE id = ?', studentId);
    return true;
  }
  return false;
}
