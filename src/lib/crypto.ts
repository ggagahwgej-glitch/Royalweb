import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cryptographic primitives for ROYALWEB AUTOPILOT.
 * - Passwords: scrypt with per-password salt.
 * - Platform credentials: AES-256-GCM at rest (never plaintext, never in the frontend).
 * - Session tokens: 256-bit random, stored only as SHA-256 hashes.
 */

const DATA_DIR = process.env.ROYALWEB_DATA_DIR || path.join(process.cwd(), 'data');
const KEY_FILE = path.join(DATA_DIR, '.keys', 'master.key');

let cachedKey: Buffer | null = null;

/**
 * Master key resolution order:
 *  1. ROYALWEB_ENCRYPTION_KEY (base64 or hex, 32 bytes) — recommended in production.
 *  2. A generated 32-byte key stored with 0600 permissions in the data directory.
 * The key never leaves the server and is excluded from git.
 */
export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envKey = process.env.ROYALWEB_ENCRYPTION_KEY;
  if (envKey) {
    const buf = /^[0-9a-f]{64}$/i.test(envKey)
      ? Buffer.from(envKey, 'hex')
      : Buffer.from(envKey, 'base64');
    if (buf.length !== 32) {
      throw new Error(
        'ROYALWEB_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or 64-char hex).'
      );
    }
    cachedKey = buf;
    return buf;
  }
  try {
    const raw = fs.readFileSync(KEY_FILE);
    if (raw.length === 32) {
      cachedKey = raw;
      return raw;
    }
  } catch {
    /* generate below */
  }
  const fresh = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY_FILE, fresh, { mode: 0o600 });
  cachedKey = fresh;
  return fresh;
}

export function encryptJson(value: unknown): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
}

export function decryptJson<T = Record<string, unknown>>(payload: string): T {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Malformed encrypted payload');
  const [, ivB64, ctB64, tagB64] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getMasterKey(),
    Buffer.from(ivB64, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const out = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(out.toString('utf8')) as T;
}

// ------------------------------------------------- passphrase-sealed documents

/**
 * Portable encryption for files that leave the machine (encrypted backups).
 *
 * The database key (getMasterKey) is machine-local by design, so a backup that
 * used it would be useless after a reinstall or on another host. Instead the
 * operator supplies a passphrase and we derive a one-off key with scrypt.
 * Same cipher as at rest: AES-256-GCM, with the header bound as AAD so editing
 * the metadata (or the file) is detected on open.
 */
export interface SealedDocument {
  format: string;
  version: number;
  alg: 'aes-256-gcm';
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  iv: string;
  tag: string;
  data: string;
  meta: Record<string, unknown>;
}

const KDF_N = 32768;
const KDF_R = 8;
const KDF_P = 1;

function headerAad(doc: Omit<SealedDocument, 'iv' | 'tag' | 'data' | 'meta'>): Buffer {
  return Buffer.from(
    [doc.format, doc.version, doc.alg, doc.kdf.name, doc.kdf.N, doc.kdf.r, doc.kdf.p, doc.kdf.salt].join('|'),
    'utf8'
  );
}

function derivePassphraseKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase.normalize('NFKC'), salt, 32, {
    N: KDF_N,
    r: KDF_R,
    p: KDF_P,
    maxmem: 128 * 1024 * 1024,
  });
}

export function sealWithPassphrase(
  plaintext: string,
  passphrase: string,
  options: { format: string; version: number; meta?: Record<string, unknown> }
): SealedDocument {
  if (!passphrase || passphrase.length < 12) {
    throw new Error('Passphrase must be at least 12 characters');
  }
  const salt = crypto.randomBytes(16);
  const key = derivePassphraseKey(passphrase, salt);
  const iv = crypto.randomBytes(12);
  const header = {
    format: options.format,
    version: options.version,
    alg: 'aes-256-gcm' as const,
    kdf: {
      name: 'scrypt' as const,
      N: KDF_N,
      r: KDF_R,
      p: KDF_P,
      salt: salt.toString('base64url'),
    },
  };
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(headerAad(header));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);
  return {
    ...header,
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    data: ciphertext.toString('base64url'),
    meta: options.meta ?? {},
  };
}

/** Throws on wrong passphrase or any modification of the file. */
export function openWithPassphrase(doc: SealedDocument, passphrase: string): string {
  if (!doc || typeof doc !== 'object') throw new Error('Not a sealed document');
  if (doc.format === undefined || !doc.kdf || !doc.iv || !doc.tag || !doc.data) {
    throw new Error('Sealed document is missing required fields');
  }
  if (doc.alg !== 'aes-256-gcm' || doc.kdf.name !== 'scrypt') {
    throw new Error(`Unsupported cipher/KDF: ${String(doc.alg)}/${String(doc.kdf.name)}`);
  }
  const salt = Buffer.from(String(doc.kdf.salt), 'base64url');
  const key = derivePassphraseKey(
    passphrase,
    salt
  );
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(doc.iv), 'base64url'));
    decipher.setAAD(
      headerAad({
        format: String(doc.format),
        version: Number(doc.version),
        alg: 'aes-256-gcm',
        kdf: {
          name: 'scrypt',
          N: Number(doc.kdf.N),
          r: Number(doc.kdf.r),
          p: Number(doc.kdf.p),
          salt: String(doc.kdf.salt),
        },
      })
    );
    decipher.setAuthTag(Buffer.from(String(doc.tag), 'base64url'));
    const out = Buffer.concat([
      decipher.update(Buffer.from(String(doc.data), 'base64url')),
      decipher.final(),
    ]);
    return out.toString('utf8');
  } finally {
    key.fill(0);
  }
}

// ---------------------------------------------------------------- passwords

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- tokens

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function pkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Mask a secret for display: never returns the full value. */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 6) return '••••••';
  return `${secret.slice(0, 2)}••••••${secret.slice(-2)}`;
}
