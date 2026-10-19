import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.ts';

/**
 * API Key 加密存储：AES-256-GCM，密钥取环境变量 APP_SECRET；
 * 没配就生成一个随机密钥落在 data/.secret（容器里随数据卷持久化）。
 */
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    cachedKey = crypto.createHash('sha256').update(fromEnv).digest();
    return cachedKey;
  }
  const file = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(file)) {
    cachedKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  } else {
    cachedKey = crypto.randomBytes(32);
    fs.writeFileSync(file, cachedKey.toString('hex'), { mode: 0o600 });
  }
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(blob: string): string {
  if (!blob) return '';
  try {
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** 给前端看的脱敏形式：sk-****abcd */
export function maskKey(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 8) return '****';
  return `${plain.slice(0, 3)}****${plain.slice(-4)}`;
}
