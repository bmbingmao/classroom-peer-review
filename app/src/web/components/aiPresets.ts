/** AI 服务商预设：下拉选一下就把 base / model 填好，key 仍需自己填 */
export type AiPreset = {
  key: string;
  label: string;
  api_base: string;
  model: string;
  note?: string;
};

export const AI_PRESETS: AiPreset[] = [
  {
    key: 'deepseek-flash',
    label: 'DeepSeek · V4.1 Flash（推荐，便宜快）',
    api_base: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    note: '已实测：一条评语约 230 tokens',
  },
  {
    key: 'deepseek-v4-pro',
    label: 'DeepSeek · V4 Pro',
    api_base: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    note: '更强但更贵，一般课堂用 Flash 就够',
  },
  {
    key: 'openai',
    label: 'OpenAI · gpt-4o-mini',
    api_base: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: '需要能访问 openai.com 的网络',
  },
  {
    key: 'qwen',
    label: '阿里通义 · qwen-plus',
    api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  {
    key: 'moonshot',
    label: '月之暗面 Kimi · moonshot-v1-8k',
    api_base: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  {
    key: 'zhipu',
    label: '智谱 GLM · glm-4-flash',
    api_base: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  {
    key: 'custom',
    label: '自定义（自己填地址和模型）',
    api_base: '',
    model: '',
  },
];

/** 根据当前 base+model 反查是哪套预设 */
export function matchPreset(apiBase: string, model: string): AiPreset | null {
  const b = (apiBase || '').trim().replace(/\/+$/, '');
  const m = (model || '').trim();
  return AI_PRESETS.find((p) => p.api_base && p.api_base.replace(/\/+$/, '') === b && p.model === m) ?? null;
}
