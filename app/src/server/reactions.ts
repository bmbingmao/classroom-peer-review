import { all, one, run, tx } from './db.ts';
import { POINTS, changePoints, pointsOf } from './points.ts';

export type EmojiDef = { key: string; label: string; positive: boolean };

export const EMOJIS: EmojiDef[] = [
  { key: '👍', label: '赞', positive: true },
  { key: '❤️', label: '喜欢', positive: true },
  { key: '🔥', label: '精彩', positive: true },
  { key: '👏', label: '鼓励', positive: true },
  { key: '💡', label: '有启发', positive: true },
  { key: '😄', label: '认可', positive: true },
  { key: '🤔', label: '存疑', positive: false },
  { key: '😐', label: '一般', positive: false },
  { key: '👎', label: '不认可', positive: false },
  { key: '🚨', label: '警报', positive: false },
];

export const FOLD_THRESHOLD = 5;
export const REACTIONS_PER_ACTIVITY = 20;

export function isEmoji(key: string): boolean {
  return EMOJIS.some((e) => e.key === key);
}

export function isPositive(key: string): boolean {
  return EMOJIS.find((e) => e.key === key)?.positive ?? false;
}

/** 某条评语的表情计数 */
export function reactionCounts(commentId: number): Record<string, number> {
  const rows = all<{ emoji: string; c: number }>(
    'SELECT emoji, COUNT(*) AS c FROM reactions WHERE comment_id = ? GROUP BY emoji',
    commentId,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.emoji] = r.c;
  return out;
}

export function myReaction(commentId: number, userId: number): string | null {
  return one<{ emoji: string }>('SELECT emoji FROM reactions WHERE comment_id = ? AND user_id = ?', commentId, userId)?.emoji ?? null;
}

export type ReactError = { status: number; message: string };

/**
 * 发表情：
 *  - 第一次发表情扣 5 分（余额不足 5 不能发）；换表情免费，不能取消（防刷）
 *  - 正面表情给作者 +1，同一人同一条内容只加一次（唯一键 (user_id, comment_id)）
 *  - 不能给自己内容发表情
 *  - 每人每活动最多 20 次
 *  - 🚨 满 5 个不同学生 → 自动折叠
 */
export function react(commentId: number, userId: number, emoji: string): { ok: true; changed: string; folded: boolean } | { ok: false; error: ReactError } {
  if (!isEmoji(emoji)) return { ok: false, error: { status: 400, message: '无效的表情' } };

  const comment = one<any>('SELECT * FROM comments WHERE id = ?', commentId);
  if (!comment) return { ok: false, error: { status: 404, message: '评语不存在' } };
  if (comment.student_id === userId) return { ok: false, error: { status: 400, message: '不能给自己的评语发表情' } };
  if (comment.moderation_status !== 'approved' || comment.folded) {
    return { ok: false, error: { status: 400, message: '这条评语当前不可互动' } };
  }

  const existing = myReaction(commentId, userId);
  if (!existing) {
    const used = one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM reactions r JOIN comments c ON c.id = r.comment_id
        WHERE r.user_id = ? AND c.activity_id = ?`,
      userId,
      comment.activity_id,
    )?.c ?? 0;
    if (used >= REACTIONS_PER_ACTIVITY) {
      return { ok: false, error: { status: 400, message: `每个活动最多发 ${REACTIONS_PER_ACTIVITY} 个表情` } };
    }
    if (pointsOf(userId) < POINTS.reactionCost) {
      return { ok: false, error: { status: 400, message: `积分不足 ${POINTS.reactionCost}，不能发表情` } };
    }
  }

  let folded = false;
  tx(() => {
    const now = Date.now();
    if (existing) {
      run('UPDATE reactions SET emoji = ?, created_at = ? WHERE comment_id = ? AND user_id = ?', emoji, now, commentId, userId);
    } else {
      run(
        'INSERT INTO reactions(user_id, comment_id, emoji, created_at) VALUES(?,?,?,?)',
        userId,
        commentId,
        emoji,
        now,
      );
      changePoints(userId, -POINTS.reactionCost, 'reaction_spend', {
        activityId: comment.activity_id,
      });
      // 第一次互动才给作者加分（换表情不重复加）
      if (isPositive(emoji) && comment.student_id && comment.student_id !== userId) {
        changePoints(comment.student_id, POINTS.positiveReceived, 'reaction_received', {
          activityId: comment.activity_id,
          operatorId: userId,
        });
      }
    }

    // 🚨 累计折叠
    const alarms = one<{ c: number }>(
      "SELECT COUNT(DISTINCT user_id) AS c FROM reactions WHERE comment_id = ? AND emoji = '🚨'",
      commentId,
    )?.c ?? 0;
    if (alarms >= FOLD_THRESHOLD && !comment.folded) {
      run('UPDATE comments SET folded = 1 WHERE id = ?', commentId);
      run(
        'INSERT INTO moderation_logs(comment_id, operator_id, action, note, created_at) VALUES(?,?,?,?,?)',
        commentId,
        0,
        'auto_fold',
        `${alarms} 个学生发警报`,
        Date.now(),
      );
      folded = true;
    }
  });

  return { ok: true, changed: emoji, folded };
}

/** 教师恢复被折叠的评语 */
export function unfold(commentId: number, operatorId: number) {
  run('UPDATE comments SET folded = 0 WHERE id = ?', commentId);
  run(
    'INSERT INTO moderation_logs(comment_id, operator_id, action, note, created_at) VALUES(?,?,?,?,?)',
    commentId,
    operatorId,
    'unfold',
    '教师恢复展示',
    Date.now(),
  );
}
