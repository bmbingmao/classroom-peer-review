import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import QRCode from 'qrcode';
import { UPLOAD_DIR } from '../db.ts';
import { bad, forbidden, notFound, str } from '../util.ts';

const router = Router();

/** 二维码（教师端投屏用）：/api/qr?text=http://192.168.1.5:3000 */
router.get('/qr', async (req: any, res, next) => {
  try {
    const text = String(req.query.text ?? '');
    if (!text || text.length > 500) throw bad('缺少 text');
    const png = await QRCode.toBuffer(text, { width: 640, margin: 2, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    next(err);
  }
});

const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;

/** 原始二进制上传（不用 multipart，前端 fetch(body: File) 即可）*/
router.post('/media', (req: any, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') throw forbidden('只有教师能上传素材');
  const buf: Buffer = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw bad('没有收到文件内容');

  const declaredType = String(req.headers['x-file-type'] || '');
  let filename = 'upload';
  try {
    filename = decodeURIComponent(String(req.headers['x-file-name'] || 'upload'));
  } catch {
    filename = String(req.headers['x-file-name'] || 'upload');
  }
  const ext = path.extname(filename).toLowerCase().slice(0, 8);
  const kind = detect(buf, declaredType, ext);
  if (!kind) throw bad('不支持的文件类型（只允许 jpg/png/webp/gif/mp4）');
  if (kind.startsWith('image') && buf.length > MAX_IMAGE) throw bad('图片不能超过 5MB');
  if (kind === 'video/mp4' && buf.length > MAX_VIDEO) throw bad('视频不能超过 100MB');

  const id = crypto.randomBytes(12).toString('hex');
  const name = `${id}.${ext === '.jpeg' ? 'jpg' : ext.replace('.', '')}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  res.json({ url: `/api/media/${name}`, kind, bytes: buf.length });
});

/** 鉴权访问媒体（禁止裸目录） */
router.get('/media/:name', (req: any, res) => {
  const name = path.basename(String(req.params.name));
  if (!/^[a-f0-9]{24}\.[a-z0-9]{2,5}$/i.test(name)) throw notFound('文件不存在');
  const full = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(full)) throw notFound('文件不存在');
  const ext = path.extname(name).toLowerCase();
  const type =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.mp4'
              ? 'video/mp4'
              : 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(full).pipe(res);
});

function detect(buf: Buffer, declared: string, ext: string): string | null {
  if (buf.length < 12) return null;
  // magic number 优先，扩展名只作参考
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  if (buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (brand.startsWith('qt')) return 'video/mp4';
    return 'video/mp4';
  }
  if (declared === 'video/mp4' && ext === '.mp4') return 'video/mp4';
  return null;
}

export default router;
