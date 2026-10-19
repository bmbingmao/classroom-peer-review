export type ApiError = { code: string; message: string; status: number; detail?: any };

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

type Options = { method?: string; body?: unknown };

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const e = data?.error ?? {};
    const err: ApiError = {
      code: e.code ?? `http_${res.status}`,
      message: e.message ?? `请求失败（${res.status}）`,
      status: res.status,
      detail: e.detail,
    };
    if (res.status === 401) onUnauthorized?.();
    throw err as unknown as Error & ApiError;
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'POST', body });
export const put = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'PUT', body });
export const patch = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'PATCH', body });
export const del = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'DELETE', body });

/** 上传媒体（原始二进制，不用 multipart） */
export async function uploadMedia(file: File): Promise<{ url: string; kind: string }> {
  const res = await fetch('/api/media', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
      'x-file-type': file.type,
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { code: data?.error?.code ?? 'upload_failed', message: data?.error?.message ?? '上传失败', status: res.status };
  return data;
}

/* ---------------- 格式化 ---------------- */

export function fmtTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDateInput(ms: number): string {
  // <input type="datetime-local"> 需要本地时间
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDateInput(v: string): number {
  return new Date(v).getTime();
}

export const STATUS_TEXT: Record<string, string> = {
  pending: '未开始',
  open: '进行中',
  ended: '已截止',
  closed: '已关闭',
};

export function statusClass(s: string): string {
  return s === 'open' ? 'badge badge-open' : s === 'ended' ? 'badge badge-ended' : s === 'closed' ? 'badge badge-closed' : 'badge badge-pending';
}

export function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  }, 2200);
}

/** 统一的错误提示 */
export function reportError(err: any) {
  toast(err?.message ? String(err.message) : '操作失败');
}
