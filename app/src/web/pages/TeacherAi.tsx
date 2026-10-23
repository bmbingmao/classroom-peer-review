import { useEffect, useState } from 'react';
import { get, post, put, reportError, toast } from '../api';
import { AI_PRESETS, matchPreset } from '../components/aiPresets';

export default function TeacherAi() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [presetKey, setPresetKey] = useState('custom');
  const [apiBase, setApiBase] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [promptText, setPromptText] = useState('');
  const [showDefault, setShowDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  async function load() {
    try {
      const r = await get('/api/teacher/ai-config');
      setCfg(r);
      const base = r.own?.api_base ?? '';
      const m = r.own?.model ?? '';
      setApiBase(base);
      setModel(m);
      setPromptText(r.own?.prompt ?? '');
      const hit = matchPreset(base, m);
      setPresetKey(hit?.key ?? 'custom');
    } catch (e) {
      reportError(e);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function applyPreset(key: string) {
    setPresetKey(key);
    const p = AI_PRESETS.find((x) => x.key === key);
    if (p && key !== 'custom') {
      setApiBase(p.api_base);
      setModel(p.model);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await put('/api/teacher/ai-config', {
        api_base: apiBase.trim(),
        model: model.trim(),
        api_key: apiKey.trim(),
        prompt: promptText,
      });
      setApiKey('');
      toast('已保存');
      load();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const r = await post('/api/teacher/ai-config/test', {});
      if (r.ok) {
        toast(`通了：${r.verdict === 'approved' ? '放行' : '驳回'}（${r.category || '正常'}）`);
      } else {
        toast(`不通：${r.error}`);
      }
    } catch (e) {
      reportError(e);
    } finally {
      setTesting(false);
    }
  }

  async function clearMine() {
    if (!confirm('清空自己的 AI 配置？清空后回退到超管的全局配置（如果有）。')) return;
    try {
      await put('/api/teacher/ai-config', {});
      setApiBase('');
      setModel('');
      setPromptText('');
      setPresetKey('custom');
      toast('已清空');
      load();
    } catch (e) {
      reportError(e);
    }
  }

  if (!cfg) return <div className="spin">加载中…</div>;

  const active = AI_PRESETS.find((p) => p.key === presetKey);

  return (
    <div className="container" style={{ maxWidth: 680 }}>
      <div className="card">
        <h3>AI 评语审核</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          学生提交评语后，系统会调用大模型判断是否放行。<b>没配置、调用失败、超过 8 秒</b>，评语都会停在「待审」等你自己放行或驳回，不会卡住学生提交。
        </p>
        <p className="hint" style={{ marginTop: -6 }}>
          只拦「不适合公开展示」的内容（辱骂、广告、色情、政治敏感、人身攻击）。
          「无」「哈哈」「好好好」这类灌水会正常上墙——课堂上的随手反应不用管。
        </p>
        <div className="row" style={{ gap: 10, marginBottom: 14 }}>
          {cfg.effective ? (
            <span className="badge badge-open">已生效</span>
          ) : (
            <span className="badge badge-closed">未配置（评语全部进待审）</span>
          )}
          {cfg.own ? (
            <span className="badge badge-type">用你自己的配置</span>
          ) : cfg.global ? (
            <span className="badge badge-pending">没配自己的，正在用超管兜底</span>
          ) : null}
        </div>

        <div className="field">
          <label>服务商预设</label>
          <select value={presetKey} onChange={(e) => applyPreset(e.target.value)}>
            {AI_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          {active?.note && <div className="hint">{active.note}</div>}
        </div>

        {presetKey === 'custom' ? (
          <>
            <div className="field">
              <label>接口地址（OpenAI 兼容，填到 /v1 为止）</label>
              <input type="text" value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api.example.com/v1" />
            </div>
            <div className="field">
              <label>模型名</label>
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model-id" />
            </div>
          </>
        ) : (
          <div className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
            地址 <code>{apiBase}</code> · 模型 <code>{model}</code>
          </div>
        )}

        <div className="field">
          <label>API Key {cfg.own?.keyMask ? `（已存：${cfg.own.keyMask}，不填就是沿用）` : ''}</label>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
          <div className="hint">加密存储（AES-256-GCM），接口返回永远脱敏。</div>
        </div>

        <div className="field">
          <label>审核提示词（可选）</label>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={7}
            placeholder="留空 = 使用超管设置的全局提示词（没设置就用系统内置默认）"
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.6 }}
          />
          <div className="hint">
            当前生效：
            {promptText.trim()
              ? ' 你自己的自定义提示词'
              : cfg.global?.prompt
                ? ' 超管设置的全局提示词'
                : ' 系统内置默认'}{' '}
            ·{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setShowDefault((v) => !v);
              }}
            >
              {showDefault ? '收起默认提示词' : '看看默认提示词'}
            </a>
            {promptText.trim() && (
              <>
                {' · '}
                <a href="#" onClick={(e) => { e.preventDefault(); setPromptText(''); }}>
                  恢复默认
                </a>
              </>
            )}
          </div>
          {showDefault && (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                background: 'var(--bg-soft, #f6f8fb)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                padding: 12,
                fontSize: 12,
                lineHeight: 1.6,
                maxHeight: 240,
                overflow: 'auto',
              }}
            >
              {cfg.effectivePrompt}
            </pre>
          )}
        </div>

        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? '保存中…' : '保存'}
          </button>
          <button className="btn" disabled={testing || !cfg.effective} onClick={test}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          {cfg.own && (
            <button className="btn btn-danger" onClick={clearMine}>
              清空我的配置
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h3>费用提醒</h3>
        <p className="muted" style={{ margin: 0 }}>
          一条评语约 230 tokens，一个班 50 人、每人 1~3 条 ≈ 1~3 万个 tokens，用 DeepSeek Flash 一堂课几厘到几分钱。
          系统对每个活动每天有调用上限（默认 300 次），超了就转人工待审。
        </p>
      </div>
    </div>
  );
}
