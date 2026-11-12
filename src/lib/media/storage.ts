import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getMasterKey } from '@/lib/crypto';

const DATA_DIR = process.env.ROYALWEB_DATA_DIR || path.join(process.cwd(), 'data');
export const UPLOAD_ROOT = path.join(DATA_DIR, 'uploads');

export function ensureDirs() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  fs.mkdirSync(path.join(UPLOAD_ROOT, 'derived'), { recursive: true });
}

export function safeExtension(filename: string, fallback = 'bin'): string {
  const ext = path.extname(filename).replace('.', '').toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : fallback;
}

/** Store an uploaded file without ever modifying it. */
export function saveOriginal(buffer: Buffer, originalName: string): string {
  ensureDirs();
  const ext = safeExtension(originalName, 'bin');
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_ROOT, filename), buffer, { flag: 'wx' });
  return filename;
}

export function absoluteMediaPath(filename: string): string {
  const resolved = path.resolve(UPLOAD_ROOT, filename);
  if (!resolved.startsWith(path.resolve(UPLOAD_ROOT))) throw new Error('Path traversal blocked');
  return resolved;
}

export function readMedia(filename: string): Buffer {
  return fs.readFileSync(absoluteMediaPath(filename));
}

export function saveDerivative(mediaId: string, preset: string, buffer: Buffer): { filename: string; bytes: number } {
  ensureDirs();
  const dir = path.join(UPLOAD_ROOT, 'derived', mediaId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${preset}.jpg`;
  const full = path.join(dir, filename);
  fs.writeFileSync(full, buffer);
  return { filename: path.posix.join('derived', mediaId, filename), bytes: buffer.length };
}

export function deleteDerivatives(mediaId: string) {
  const dir = path.join(UPLOAD_ROOT, 'derived', mediaId);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function deleteOriginal(filename: string) {
  try {
    fs.unlinkSync(absoluteMediaPath(filename));
  } catch {
    /* already gone */
  }
}

export function publicBaseUrl(): string | undefined {
  const base = process.env.PUBLIC_BASE_URL;
  return base ? base.replace(/\/+$/, '') : undefined;
}

/**
 * Signed media URL for platforms that require a reachable image URL.
 * The signature prevents the local media library from being enumerable.
 */
function mediaSignature(mediaId: string, preset: string) {
  return crypto.createHmac('sha256', getMasterKey()).update(`media:${mediaId}:${preset}`).digest('base64url');
}

export function signedMediaUrl(mediaId: string, preset = 'original'): string | undefined {
  const base = publicBaseUrl();
  if (!base) return undefined;
  const params = new URLSearchParams({ preset, sig: mediaSignature(mediaId, preset) });
  return `${base}/api/public/media/${mediaId}?${params.toString()}`;
}

export function verifyMediaSignature(mediaId: string, sig: string, preset = 'original'): boolean {
  const expected = mediaSignature(mediaId, preset);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function readDerivative(mediaId: string, preset: string): Buffer | null {
  const full = path.join(UPLOAD_ROOT, 'derived', mediaId, `${preset}.jpg`);
  try {
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}

export function fileStats(filename: string) {
  try {
    const st = fs.statSync(absoluteMediaPath(filename));
    return { bytes: st.size, modified: st.mtime };
  } catch {
    return null;
  }
}
