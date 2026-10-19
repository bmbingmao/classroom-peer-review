import { all, one, run } from './db.ts';
import { aiCallsToday, aiCapFor, moderate, recordAiCall, resolveAiConfig } from './ai.ts';

/**
 * 评语 AI 审核队列：提交接口不等结果，先落 pending，后台异步判。
 * 并发 2，单条 8 秒超时；失败/超时/没配 AI → 保持 pending 等教师人工处理。
 */
const queue: number[] = [];
const inFlight = new Set<number>();
let active = 0;
const MAX_CONCURRENT = 2;

export function enqueueComment(commentId: number) {
  if (inFlight.has(commentId) || queue.includes(commentId)) return;
  queue.push(commentId);
  setTimeout(() => void drain(), 0);
}

/** 启动时把最近一天还挂着的 pending 重新排队 */
export function resumePending() {
  const rows = all<{ id: number }>(
    "SELECT id FROM comments WHERE moderation_status = 'pending' AND created_at > ? ORDER BY id LIMIT 100",
    Date.now() - 86_400_000,
  );
  for (const r of rows) enqueueComment(r.id);
  if (rows.length) console.log(`[ai] 重新排队 ${rows.length} 条待审评语`);
}

async function drain() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const id = queue.shift() as number;
    active += 1;
    inFlight.add(id);
    void process(id)
      .catch((e) => console.error('[ai] 处理失败', id, e?.message ?? e))
      .finally(() => {
        active -= 1;
        inFlight.delete(id);
        setTimeout(() => void drain(), 0);
      });
  }
}

async function process(commentId: number) {
  const c = one<any>('SELECT * FROM comments WHERE id = ?', commentId);
  if (!c || c.moderation_status !== 'pending') return;

  const act = one<any>('SELECT * FROM activities WHERE id = ?', c.activity_id);
  if (!act) return;

  const cfg = resolveAiConfig(act.teacher_id);
  if (!cfg) return; // 没配 AI：保持 pending，教师手动审

  const cap = aiCapFor(act.id);
  if (aiCallsToday(act.id) >= cap) {
    console.log(`[ai] 活动 ${act.id} 今日调用已到上限 ${cap}，保持待审`);
    return;
  }

  const out = await moderate(c.content, cfg);
  if (!out.ok) {
    recordAiCall(act.id, false, out.error);
    // 失败就停在 pending，等教师人工放行/驳回
    return;
  }

  recordAiCall(act.id, true, out.verdict);
  if (out.verdict === 'approved') {
    run(
      "UPDATE comments SET moderation_status = 'approved', ai_category = '', reject_reason = '' WHERE id = ?",
      commentId,
    );
  } else {
    run(
      "UPDATE comments SET moderation_status = 'rejected', ai_category = ?, reject_reason = ? WHERE id = ?",
      out.category || '其他',
      out.reason || 'AI 判定不通过',
      commentId,
    );
  }
  run(
    'INSERT INTO moderation_logs(comment_id, operator_id, action, note, created_at) VALUES(?,?,?,?,?)',
    commentId,
    0,
    out.verdict === 'approved' ? 'ai_approve' : 'ai_reject',
    out.category || '',
    Date.now(),
  );
}
