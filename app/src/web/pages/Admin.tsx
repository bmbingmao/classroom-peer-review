import { useEffect, useState } from 'react';
import { del, get, patch, post, put, reportError, toast } from '../api';
import { AI_PRESETS, matchPreset } from '../components/aiPresets';

export default function Admin() {
  const [ai, setAi] = useState<any | null>(null);
  const [aiBase, setAiBase] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [showDefaultPrompt, setShowDefaultPrompt] = useState(false);
  const [defaultPromptText, setDefaultPromptText] = useState('');
  const [aiPreset, setAiPreset] = useState('custom');
  const [aiTesting, setAiTesting] = useState(false);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [status, setStatus] = useState<any | null>(null);
  const [form, setForm] = useState({ username: '', display_name: '', password: '' });
  const [showForm, setShowForm] = useState(false);

  async function load() {
    try {
      const [t, s, a] = await Promise.all([
        get('/api/admin/teachers'),
        get('/api/admin/status'),
        get('/api/admin/ai-config'),
      ]);
      setTeachers(t.teachers);
      setStatus(s);
      setAi(a.ai);
      setAiBase(a.ai?.api_base ?? '');
      setAiModel(a.ai?.model ?? '');
      setAiPrompt(a.ai?.prompt ?? '');
      setDefaultPromptText(a.defaultPrompt ?? '');
      setAiPreset(matchPreset(a.ai?.api_base ?? '', a.ai?.model ?? '')?.key ?? 'custom');
    } catch (e) {
      reportError(e);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!form.username || !form.display_name || form.password.length < 6) return toast('账号、姓名必填，密码至少 6 位');
    try {
      await post('/api/admin/teachers', form);
      toast('已开通');
      setForm({ username: '', display_name: '', password: '' });
      setShowForm(false);
      load();
    } catch (e) {
      reportError(e);
    }
  }

  async function toggle(t: any) {
    const next = t.status === 'active' ? 'disabled' : 'active';
    if (!confirm(`${next === 'disabled' ? '禁用' : '启用'}教师「${t.display_name}」？`)) return;
    try {
      await patch(`/api/admin/teachers/${t.id}`, { status: next });
      load();
    } catch (e) {
      reportError(e);
    }
  }

  async function resetPwd(t: any) {
    const pwd = prompt(`给「${t.display_name}」设置新密码（至少 6 位）`);
    if (!pwd) return;
    if (pwd.length < 6) return toast('密码至少 6 位');
    try {
      await post(`/api/admin/teachers/${t.id}/reset-password`, { password: pwd });
      toast('已重置');
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <div className="container">
      {status && (
        <div className="card">
          <div className="row" style={{ gap: 26 }}>
            <div>
              <div className="muted">教师</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{status.counts.teachers}</div>
            </div>
            <div>
              <div className="muted">学生</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{status.counts.students}</div>
            </div>
            <div>
              <div className="muted">评价项</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{status.counts.activities}</div>
            </div>
            <div>
              <div className="muted">当前在线会话</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{status.counts.sessions}</div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="spread">
          <h3 style={{ margin: 0 }}>教师账号</h3>
          <button className="btn btn-sm btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? '收起' : '+ 开通教师'}
          </button>
        </div>

        {showForm && (
          <div style={{ marginTop: 14 }}>
            <div className="row">
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>登录账号</label>
                <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>教师姓名</label>
                <input type="text" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>初始密码</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={create}>
              确认开通
            </button>
          </div>
        )}

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="table">
            <thead>
              <tr>
                <th>账号</th>
                <th>姓名</th>
                <th>学生数</th>
                <th>评价项</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id}>
                  <td>{t.username}</td>
                  <td>{t.display_name}</td>
                  <td>{t.student_count}</td>
                  <td>{t.activity_count}</td>
                  <td>
                    {t.status === 'active' ? (
                      <span className="badge badge-open">正常</span>
                    ) : (
                      <span className="badge badge-closed">已禁用</span>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <button className="btn btn-sm" onClick={() => toggle(t)}>
                        {t.status === 'active' ? '禁用' : '启用'}
                      </button>
                      <button className="btn btn-sm" onClick={() => resetPwd(t)}>
                        重置密码
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {teachers.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    还没有教师账号
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>全局 AI 审核兜底</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          教师自己没配 AI 时，用这里的配置。都空着的话，所有评语进待审队列由教师人工处理。
        </p>

        <div className="field">
          <label>服务商预设</label>
          <select
            value={aiPreset}
            onChange={(e) => {
              const key = e.target.value;
              setAiPreset(key);
              const p = AI_PRESETS.find((x) => x.key === key);
              if (p && key !== 'custom') {
                setAiBase(p.api_base);
                setAiModel(p.model);
              }
            }}
          >
            {AI_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {aiPreset === 'custom' ? (
          <>
            <div className="field">
              <label>接口地址（OpenAI 兼容，填到 /v1）</label>
              <input type="text" value={aiBase} onChange={(e) => setAiBase(e.target.value)} placeholder="https://api.example.com/v1" />
            </div>
            <div className="field">
              <label>模型名</label>
              <input type="text" value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="model-id" />
            </div>
          </>
        ) : (
          <div className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
            地址 <code>{aiBase}</code> · 模型 <code>{aiModel}</code>
          </div>
        )}

        <div className="field">
          <label>API Key {ai?.keyMask ? `（已存 ${ai.keyMask}，不填沿用）` : ''}</label>
          <input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="sk-..." />
          <div className="hint">加密存储（AES-256-GCM），接口返回永远脱敏。</div>
        </div>

        <div className="field">
          <label>全局审核提示词（教师没自定义时用这个）</label>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={7}
            placeholder="留空 = 使用系统内置默认提示词"
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.6 }}
          />
          <div className="hint">
            教师端可以自己改提示词，以教师自己的为准；教师没填才用这里的；这里也空着就用系统内置。
            <a
              href="#"
              style={{ marginLeft: 8 }}
              onClick={(e) => {
                e.preventDefault();
                setShowDefaultPrompt((v) => !v);
              }}
            >
              {showDefaultPrompt ? '收起内置默认' : '看看内置默认'}
            </a>
          </div>
          {showDefaultPrompt && (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                background: 'var(--bg-soft, #f6f8fb)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                padding: 12,
                fontSize: 12,
                lineHeight: 1.6,
                maxHeight: 260,
                overflow: 'auto',
              }}
            >
              {defaultPromptText}
            </pre>
          )}
        </div>

        <div className="row">
          <button
            className="btn btn-primary btn-sm"
            onClick={async () => {
              try {
                await put('/api/admin/ai-config', {
                  api_base: aiBase.trim(),
                  model: aiModel.trim(),
                  api_key: aiKey.trim(),
                  prompt: aiPrompt,
                });
                setAiKey('');
                toast('已保存');
                load();
              } catch (e) {
                reportError(e);
              }
            }}
          >
            保存
          </button>
          <button
            className="btn btn-sm"
            disabled={aiTesting || !ai}
            onClick={async () => {
              setAiTesting(true);
              try {
                const r = await post('/api/admin/ai-config/test', {});
                toast(r.ok ? `通了：${r.verdict === 'approved' ? '放行' : '驳回'}（${r.category || '正常'}）` : `不通：${r.error}`);
              } catch (e) {
                reportError(e);
              } finally {
                setAiTesting(false);
              }
            }}
          >
            {aiTesting ? '测试中…' : '测试连接'}
          </button>
        </div>
      </div>

      <div className="muted" style={{ textAlign: 'center' }}>
        课堂互评系统 v{status?.version ?? '0.1.0'}
      </div>
    </div>
  );
}
