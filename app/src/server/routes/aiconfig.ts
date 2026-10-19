import { Router } from 'express';
import { one, run } from '../db.ts';
import { int } from '../util.ts';
import { decryptSecret, encryptSecret, maskKey } from '../crypto.ts';
import { moderate, resolveAiConfig } from '../ai.ts';

export const teacherAi = Router();
export const adminAi = Router();

/** 教师自己的 AI 配置（没配就用超管兜底） */
teacherAi.get('/ai-config', (req: any, res) => {
  const own = one<any>('SELECT * FROM ai_config WHERE teacher_id = ?', req.user.id);
  const global_ = one<any>('SELECT * FROM ai_config WHERE teacher_id = 0');
  const effective = resolveAiConfig(req.user.id);
  res.json({
    own: own
      ? { api_base: own.api_base, model: own.model, keyMask: maskKey(decryptSecret(own.api_key_enc)), updated_at: own.updated_at }
      : null,
    global: global_
      ? { api_base: global_.api_base, model: global_.model, configured: true }
      : null,
    effective: !!effective,
  });
});

teacherAi.put('/ai-config', (req: any, res) => {
  const api_base = String(req.body?.api_base ?? '').trim();
  const model = String(req.body?.model ?? '').trim();
  const api_key = String(req.body?.api_key ?? '').trim();

  if (!api_base && !model && !api_key) {
    run('DELETE FROM ai_config WHERE teacher_id = ?', req.user.id);
    return res.json({ ok: true, cleared: true });
  }
  if (!/^https?:\/\//.test(api_base)) return res.status(400).json({ error: { code: 'bad_request', message: '接口地址要以 http(s):// 开头' } });
  if (!model) return res.status(400).json({ error: { code: 'bad_request', message: 'model 不能为空' } });

  const existing = one<any>('SELECT * FROM ai_config WHERE teacher_id = ?', req.user.id);
  // 不传 key 表示沿用原 key
  const keyEnc = api_key ? encryptSecret(api_key) : existing?.api_key_enc ?? '';
  if (!keyEnc) return res.status(400).json({ error: { code: 'bad_request', message: 'api_key 不能为空' } });

  run(
    `INSERT INTO ai_config(teacher_id, api_base, api_key_enc, model, updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(teacher_id) DO UPDATE SET api_base = excluded.api_base, api_key_enc = excluded.api_key_enc,
       model = excluded.model, updated_at = excluded.updated_at`,
    req.user.id,
    api_base,
    keyEnc,
    model,
    Date.now(),
  );
  res.json({ ok: true });
});


/** 试跑一次审核，验证 key / 模型 / 网络通不通 */
teacherAi.post('/ai-config/test', async (req: any, res) => {
  const cfg = resolveAiConfig(req.user.id);
  if (!cfg) {
    return res.json({ ok: false, error: '还没配置 AI：自己没填，也没有超管兜底' });
  }
  const sample =
    typeof req.body?.text === 'string' && req.body.text.trim()
      ? req.body.text.trim().slice(0, 500)
      : '作品完成度不错，但配色可以再大胆一点。';
  const out = await moderate(sample, cfg);
  res.json({ model: cfg.model, api_base: cfg.api_base, ...out });
});

/** 超管全局兜底配置（teacher_id = 0） */
adminAi.get('/ai-config', (_req: any, res) => {
  const g = one<any>('SELECT * FROM ai_config WHERE teacher_id = 0');
  res.json({
    ai: g ? { api_base: g.api_base, model: g.model, keyMask: maskKey(decryptSecret(g.api_key_enc)), updated_at: g.updated_at } : null,
  });
});

adminAi.put('/ai-config', (req: any, res) => {
  const api_base = String(req.body?.api_base ?? '').trim();
  const model = String(req.body?.model ?? '').trim();
  const api_key = String(req.body?.api_key ?? '').trim();

  if (!api_base && !model && !api_key) {
    run('DELETE FROM ai_config WHERE teacher_id = 0');
    return res.json({ ok: true, cleared: true });
  }
  if (!/^https?:\/\//.test(api_base)) return res.status(400).json({ error: { code: 'bad_request', message: '接口地址要以 http(s):// 开头' } });
  if (!model) return res.status(400).json({ error: { code: 'bad_request', message: 'model 不能为空' } });

  const existing = one<any>('SELECT * FROM ai_config WHERE teacher_id = 0');
  const keyEnc = api_key ? encryptSecret(api_key) : existing?.api_key_enc ?? '';
  if (!keyEnc) return res.status(400).json({ error: { code: 'bad_request', message: 'api_key 不能为空' } });

  run(
    `INSERT INTO ai_config(teacher_id, api_base, api_key_enc, model, updated_at) VALUES(0,?,?,?,?)
     ON CONFLICT(teacher_id) DO UPDATE SET api_base = excluded.api_base, api_key_enc = excluded.api_key_enc,
       model = excluded.model, updated_at = excluded.updated_at`,
    api_base,
    keyEnc,
    model,
    Date.now(),
  );
  res.json({ ok: true });
});

adminAi.post('/ai-config/test', async (req: any, res) => {
  const cfg = resolveAiConfig(0);
  if (!cfg) return res.json({ ok: false, error: '全局兜底还没配置' });
  const sample =
    typeof req.body?.text === 'string' && req.body.text.trim()
      ? req.body.text.trim().slice(0, 500)
      : '加我微信代写作业，价格便宜';
  const out = await moderate(sample, cfg);
  res.json({ model: cfg.model, api_base: cfg.api_base, ...out });
});
