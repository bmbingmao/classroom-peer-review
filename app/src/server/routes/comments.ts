import { Router } from 'express';
import { all, one, run } from '../db.ts';
import { int, notFound, optStr, str } from '../util.ts';
import { getActivityForStudent, getActivityForTeacher } from '../lib.ts';
import { EMOJIS, myReaction, react, reactionCounts, unfold } from '../reactions.ts';

export const teacherComments = Router();
export const studentComments = Router();

/* ==================== 学生端 ==================== */

/** 某活动已通过且未折叠的评语墙 */
studentComments.get('/activities/:id/comments', (req: any, res) => {
  const a = getActivityForStudent(int(req.params.id, 'id'), req.user.id);
  const rows = all<any>(
    `SELECT id, target_id, content, created_at FROM comments
      WHERE activity_id = ? AND moderation_status = 'approved' AND folded = 0
      ORDER BY created_at DESC LIMIT 200`,
    a.id,
  );
  res.json({
    emojis: EMOJIS,
    comments: rows.map((c) => ({
      ...c,
      mine: c.id === 0 ? false : undefined,
      reactions: reactionCounts(c.id),
      myReaction: myReaction(c.id, req.user.id),
      isAuthor: isAuthorOf(c.id, req.user.id),
    })),
  });
});

/** 发表情 */
studentComments.post('/comments/:id/reaction', (req: any, res) => {
  const id = int(req.params.id, 'id');
  const emoji = str(req.body?.emoji, '表情', 8);
  const r = react(id, req.user.id, emoji);
  if (!r.ok) {
    const e: any = new Error(r.error.message);
    e.status = r.error.status;
    e.code = 'reaction_failed';
    throw e;
  }
  res.json(r);
});

/* ==================== 教师端 ==================== */

/** 评语列表（含待审/已驳回/被折叠） */
teacherComments.get('/activities/:id/comments', (req: any, res) => {
  const a = getActivityForTeacher(int(req.params.id, 'id'), req.user.id);
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  // 默认不下发作者姓名：要真名走 /activities/:id/identities（小眼睛）
  const sql =
    `SELECT c.* FROM comments c WHERE c.activity_id = ?` +
    (['pending', 'approved', 'rejected'].includes(status) ? ' AND c.moderation_status = ?' : '') +
    ' ORDER BY c.id DESC LIMIT 500';
  const rows = status ? all<any>(sql, a.id, status) : all<any>(sql, a.id);
  res.json({
    emojis: EMOJIS,
    comments: rows.map((c) => ({ ...c, reactions: reactionCounts(c.id) })),
  });
});

/** 放行 / 驳回 */
teacherComments.post('/comments/:id/moderate', (req: any, res) => {
  const id = int(req.params.id, 'id');
  const action = str(req.body?.action, 'action', 16);
  const reason = optStr(req.body?.reason, '原因', 200);
  const c = one<any>('SELECT * FROM comments WHERE id = ?', id);
  if (!c) throw notFound('评语不存在');
  getActivityForTeacher(c.activity_id, req.user.id);

  if (action === 'approve') {
    run("UPDATE comments SET moderation_status = 'approved', ai_category = '', reject_reason = '' WHERE id = ?", id);
  } else if (action === 'reject') {
    run(
      "UPDATE comments SET moderation_status = 'rejected', reject_reason = ?, ai_category = CASE WHEN ai_category = '' THEN '其他' ELSE ai_category END WHERE id = ?",
      reason || '教师驳回',
      id,
    );
  } else {
    throw notFound('action 只能是 approve 或 reject');
  }
  run(
    'INSERT INTO moderation_logs(comment_id, operator_id, action, note, created_at) VALUES(?,?,?,?,?)',
    id,
    req.user.id,
    `teacher_${action}`,
    reason,
    Date.now(),
  );
  res.json({ ok: true });
});

/** 恢复被 🚨 自动折叠的评语 */
teacherComments.post('/comments/:id/fold', (req: any, res) => {
  const id = int(req.params.id, 'id');
  const c = one<any>('SELECT * FROM comments WHERE id = ?', id);
  if (!c) throw notFound('评语不存在');
  getActivityForTeacher(c.activity_id, req.user.id);
  const folded = req.body?.folded !== false;
  if (folded) run('UPDATE comments SET folded = 1 WHERE id = ?', id);
  else unfold(id, req.user.id);
  res.json({ ok: true });
});

/** 热词云 */
teacherComments.get('/activities/:id/words', (req: any, res) => {
  const a = getActivityForTeacher(int(req.params.id, 'id'), req.user.id);
  const rows = all<{ content: string }>(
    "SELECT content FROM comments WHERE activity_id = ? AND moderation_status = 'approved' AND folded = 0",
    a.id,
  );
  res.json({ words: hotWords(rows.map((r) => r.content)).slice(0, 20) });
});

/* ==================== 小眼睛 ==================== */

/** 教师点小眼睛才拉真实身份（单独鉴权接口，主结果接口不带真名） */
teacherComments.get('/activities/:id/identities', (req: any, res) => {
  const a = getActivityForTeacher(int(req.params.id, 'id'), req.user.id);
  const targets = all<any>(
    `SELECT t.id AS target_id, t.anon_label, u.id, u.display_name, u.username
       FROM score_targets t LEFT JOIN users u ON u.id = t.student_id
      WHERE t.activity_id = ?`,
    a.id,
  );
  const judges = all<any>(
    `SELECT DISTINCT sr.student_id AS id, u.display_name, u.username
       FROM score_records sr JOIN users u ON u.id = sr.student_id
      WHERE sr.activity_id = ?`,
    a.id,
  );
  const commentAuthors = all<any>(
    `SELECT DISTINCT u.id, u.display_name, u.username
       FROM comments c JOIN users u ON u.id = c.student_id
      WHERE c.activity_id = ?`,
    a.id,
  );
  res.json({
    targets: targets.filter((t) => t.id).map((t) => ({ targetId: t.target_id, anonLabel: t.anon_label, name: t.display_name, username: t.username })),
    judges: judges.map((j) => ({ id: j.id, display_name: j.display_name, username: j.username })),
    commentAuthors: commentAuthors.map((x) => ({ id: x.id, display_name: x.display_name, username: x.username })),
  });
});

/* ==================== helpers ==================== */

function isAuthorOf(commentId: number, userId: number): boolean {
  return one<any>('SELECT 1 AS x FROM comments WHERE id = ? AND student_id = ?', commentId, userId) !== undefined;
}

const STOP = new Set([
  '的', '了', '是', '很', '这个', '那个', '一个', '我们', '他们', '可以', '有点', '觉得', '就是', '还是', '没有', '什么',
  '不错', '真的', '但是', '而且', '所以', '这样', '感觉', '比较', '一点', '一下', '话', '你', '我', '他', '她', '它',
  'the', 'and', 'very', 'good', 'nice',
]);

export function hotWords(texts: string[]): { word: string; count: number }[] {
  const freq = new Map<string, number>();
  for (const text of texts) {
    const cleaned = String(text).replace(/[a-zA-Z0-9]+/g, ' ').replace(/[^\u4e00-\u9fa5]+/g, ' ');
    // 中文按 2-4 字滑窗统计（无分词器的轻量替代）
    for (const seg of cleaned.split(/\s+/)) {
      if (!seg) continue;
      for (let n = 2; n <= 4; n++) {
        for (let i = 0; i + n <= seg.length; i++) {
          const w = seg.slice(i, i + n);
          if (STOP.has(w)) continue;
          freq.set(w, (freq.get(w) ?? 0) + 1);
        }
      }
    }
  }
  const arr = [...freq.entries()].map(([word, count]) => ({ word, count }));
  // 去掉被更长词包含且频次相同的碎片
  const set = new Set(arr.map((a) => a.word));
  const filtered = arr.filter((a) => {
    if (a.count < 2) return false;
    for (const other of set) {
      if (other.length > a.word.length && other.includes(a.word)) {
        const oc = arr.find((x) => x.word === other)?.count ?? 0;
        if (oc >= a.count) return false;
      }
    }
    return true;
  });
  return filtered.sort((x, y) => y.count - x.count || x.word.length - y.word.length);
}
