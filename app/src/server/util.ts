/** 通用工具：错误、参数校验、时间 */

export class HttpError extends Error {
  status: number;
  code: string;
  detail: unknown;

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const bad = (msg: string, detail?: unknown) => new HttpError(400, 'bad_request', msg, detail);
export const unauthorized = (msg = '未登录') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = '无权访问') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = '不存在') => new HttpError(404, 'not_found', msg);

export function str(v: unknown, field: string, max = 2000): string {
  if (typeof v !== 'string') throw bad(`${field} 必须是字符串`);
  const s = v.trim();
  if (!s) throw bad(`${field} 不能为空`);
  if (s.length > max) throw bad(`${field} 过长（最多 ${max} 字）`);
  return s;
}

export function optStr(v: unknown, field: string, max = 2000): string {
  if (v === undefined || v === null || v === '') return '';
  return str(v, field, max);
}

export function int(v: unknown, field: string, min?: number, max?: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw bad(`${field} 必须是整数`);
  if (min !== undefined && n < min) throw bad(`${field} 不能小于 ${min}`);
  if (max !== undefined && n > max) throw bad(`${field} 不能大于 ${max}`);
  return n;
}

export function num(v: unknown, field: string, min?: number, max?: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw bad(`${field} 必须是数字`);
  if (min !== undefined && n < min) throw bad(`${field} 不能小于 ${min}`);
  if (max !== undefined && n > max) throw bad(`${field} 不能大于 ${max}`);
  return n;
}

export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

export function arr(v: unknown, field: string): unknown[] {
  if (!Array.isArray(v)) throw bad(`${field} 必须是数组`);
  return v;
}

export const now = () => Date.now();

/** 接受毫秒时间戳或 ISO 字符串，返回毫秒 */
export function ts(v: unknown, field: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim()) {
    const n = Date.parse(v);
    if (Number.isFinite(n)) return n;
  }
  throw bad(`${field} 不是合法时间`);
}

export function jsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
