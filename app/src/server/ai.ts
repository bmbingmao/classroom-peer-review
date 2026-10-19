import { all, one, run } from './db.ts';
import { decryptSecret } from './crypto.ts';

/** AI 审核：OpenAI 兼容接口，固定 6 类违规，返回非法一律当作待审 */
export const AI_CATEGORIES = ['辱骂', '广告', '色情', '政治敏感', '人身攻击', '其他'] as const;
export type AiCategory = (typeof AI_CATEGORIES)[number];

export type AiCfg = { api_base: string; api_key: string; model: string };

/** 取生效配置：教师私有优先，回退全局兜底；都没有返回 null */
export function resolveAiConfig(teacherId: number): AiCfg | null {
  const own = one<any>('SELECT * FROM ai_config WHERE teacher_id = ?', teacherId);
  const global_ = one<any>('SELECT * FROM ai_config WHERE teacher_id = 0');
  for (const row of [own, global_]) {
    if (!row) continue;
    const api_key = decryptSecret(row.api_key_enc);
    if (row.api_base && api_key && row.model) {
      return { api_base: row.api_base.replace(/\/+$/, ''), api_key, model: row.model };
    }
  }
  return null;
}

const PROMPT = `你是课堂互评系统的评语审核员。学生给同学的作品写评语，你判断这条评语能否公开展示。
只输出一个 JSON 对象，不要任何多余文字：
{"verdict":"approved"|"rejected","category":"辱骂|广告|色情|政治敏感|人身攻击|其他","reason":"不超过30字"}
判定标准：
- 建设性批评、指出缺点、语气直接但就事论事 → approved
- 辱骂、人身攻击、歧视、色情、广告引流、政治敏感 → rejected
- 与作品无关的灌水（如“啊啊啊”“123”）→ rejected，category=其他
- 拿不准 → approved`;

export type ModerationOutcome =
  | { ok: true; verdict: 'approved' | 'rejected'; category: string; reason: string }
  | { ok: false; error: string };

export async function moderate(content: string, cfg: AiCfg): Promise<ModerationOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // 8 秒超时，超了就当失败进待审

  try {
    const res = await fetch(`${cfg.api_base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.api_key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: `评语：${content}` },
        ],
      }),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      return { ok: false, error: `HTTP ${res.status} ${body}` };
    }

    const data: any = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(text);
    if (!parsed || (parsed.verdict !== 'approved' && parsed.verdict !== 'rejected')) {
      return { ok: false, error: '模型返回无法解析' };
    }
    const category = AI_CATEGORIES.includes(parsed.category) ? parsed.category : parsed.verdict === 'rejected' ? '其他' : '';
    return {
      ok: true,
      verdict: parsed.verdict,
      category,
      reason: String(parsed.reason ?? '').slice(0, 60),
    };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'AbortError' ? '超时（8s）' : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text: string): any | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ---------------- 调用预算 ---------------- */

const DEFAULT_DAILY_CAP = Number(process.env.AI_DAILY_CAP || 300);

export function aiCapFor(activityId: number): number {
  return DEFAULT_DAILY_CAP;
}

export function aiCallsToday(activityId: number): number {
  const since = Date.now() - 86_400_000;
  return (
    one<{ c: number }>('SELECT COUNT(*) AS c FROM ai_calls WHERE activity_id = ? AND created_at > ?', activityId, since)?.c ?? 0
  );
}

export function recordAiCall(activityId: number, ok: boolean, note: string) {
  run('INSERT INTO ai_calls(activity_id, ok, note, created_at) VALUES(?,?,?,?)', activityId, ok ? 1 : 0, note.slice(0, 200), Date.now());
}
