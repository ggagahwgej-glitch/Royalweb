/**
 * Runtime/deployment detection.
 *
 * The app keeps its state in SQLite plus a media directory. That is ideal on a
 * machine with a disk (Docker, Railway, Render, Fly, a VPS) and impossible on a
 * serverless platform that gives each invocation a throw-away filesystem.
 *
 * Rather than crash with EROFS/ENOENT — or worse, silently write to a read-only
 * path — every storage decision goes through this module:
 *
 *   • a persistent host uses `<cwd>/data` (or `ROYALWEB_DATA_DIR`)
 *   • a serverless host uses `/tmp/royalweb` and reports `ephemeral` storage,
 *     so the operator sees an explicit warning instead of discovering data loss
 *   • a configured directory that cannot actually be written is NOT trusted:
 *     the resolver falls back to a writable location and reports why, instead
 *     of letting the first database call throw a bare EACCES/EROFS at render
 *     time (that is what produced the opaque "Application error: a server-side
 *     exception" page on Vercel).
 *
 * Nothing here is ever presented as durable when it is not.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type RuntimePlatform = 'vercel' | 'netlify' | 'lambda' | 'node';
export type StorageMode = 'persistent' | 'ephemeral';

const SERVERLESS_FALLBACK = path.join('/tmp', 'royalweb');

function detectPlatform(): RuntimePlatform {
  if (process.env.VERCEL) return 'vercel';
  if (process.env.NETLIFY) return 'netlify';
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return 'lambda';
  return 'node';
}

export function runtimePlatform(): RuntimePlatform {
  return detectPlatform();
}

export function isServerless(): boolean {
  return detectPlatform() !== 'node';
}

/** Returns null when `dir` can be created and written to, otherwise the error text. */
function probe(dir: string): string | null {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(file, 'ok');
    fs.rmSync(file, { force: true });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export interface DataDirResolution {
  /** Directory actually in use — always writable unless `writable` is false. */
  dir: string;
  /** Value of ROYALWEB_DATA_DIR, when the operator set one. */
  requested: string | null;
  /** Set when the preferred directory was unusable and another one is used. */
  fallbackReason: string | null;
  writable: boolean;
}

let cached: DataDirResolution | null = null;

function candidates(): string[] {
  const list: string[] = [];
  const configured = process.env.ROYALWEB_DATA_DIR?.trim();
  if (configured) list.push(configured);
  list.push(isServerless() ? SERVERLESS_FALLBACK : path.join(process.cwd(), 'data'));
  // Last resorts: the platform temp dir. Always present, never durable.
  list.push(SERVERLESS_FALLBACK, path.join(os.tmpdir(), 'royalweb'));
  return [...new Set(list)];
}

/**
 * Resolve (and cache) a writable data directory.
 *
 * Probe order: `ROYALWEB_DATA_DIR` → platform default → `/tmp/royalweb`.
 * The first writable candidate wins; when it is not the requested one the
 * reason is kept so the UI/health output can say exactly what happened.
 */
export function resolveDataDir(): DataDirResolution {
  if (cached) return cached;
  const configured = process.env.ROYALWEB_DATA_DIR?.trim() || null;
  const dirs = candidates();
  const first = dirs[0];
  const firstError = probe(first);

  if (!firstError) {
    cached = { dir: first, requested: configured, fallbackReason: null, writable: true };
    return cached;
  }

  for (const dir of dirs.slice(1)) {
    if (!probe(dir)) {
      const fallbackReason =
        `${first} is not writable (${firstError}) — falling back to ${dir}. ` +
        'Data written there will not survive a restart; point ROYALWEB_DATA_DIR at a writable volume.';
      console.warn(`[runtime] ${fallbackReason}`);
      cached = { dir, requested: configured, fallbackReason, writable: true };
      return cached;
    }
  }

  // Nothing is writable (should not happen on any supported host).
  console.error(`[runtime] no writable data directory found (last: ${first}, ${firstError})`);
  cached = { dir: first, requested: configured, fallbackReason: firstError, writable: false };
  return cached;
}

/**
 * Directory that holds the database, uploads and snapshots.
 * `ROYALWEB_DATA_DIR` always wins when it is writable.
 */
export function dataDir(): string {
  return resolveDataDir().dir;
}

/**
 * Human-readable description of a storage problem, or null when the data
 * directory is exactly where the operator asked for it.
 */
export function dataDirIssue(): string | null {
  const res = resolveDataDir();
  if (!res.writable) {
    return `No writable data directory: ${res.fallbackReason ?? 'unknown error'}. The database cannot be opened.`;
  }
  return res.fallbackReason;
}

/** True when the data directory survives restarts and is shared by all instances. */
export function storageMode(): StorageMode {
  const { dir } = resolveDataDir();
  const tmpRoots = ['/tmp', '/var/tmp', os.tmpdir(), SERVERLESS_FALLBACK];
  if (tmpRoots.some((root) => dir === root || dir.startsWith(`${root}${path.sep}`))) return 'ephemeral';
  return isServerless() ? 'ephemeral' : 'persistent';
}

export function isEphemeral(): boolean {
  return storageMode() === 'ephemeral';
}

/** Region hint for the UI (Vercel sets this; harmless elsewhere). */
export function region(): string | null {
  return process.env.VERCEL_REGION ?? process.env.FLY_REGION ?? null;
}

export interface RuntimeReport {
  platform: RuntimePlatform;
  serverless: boolean;
  storage: StorageMode;
  dataDir: string;
  dataDirRequested: string | null;
  dataDirIssue: string | null;
  writable: boolean;
  node: string;
  region: string | null;
  worker: 'in-process' | 'cron';
  warnings: string[];
}

export function runtimeReport(): RuntimeReport {
  const res = resolveDataDir();
  const storage = storageMode();
  const serverless = isServerless();
  const issue = dataDirIssue();
  const warnings: string[] = [];

  if (issue) warnings.push(issue);
  if (storage === 'ephemeral') {
    warnings.push(
      'This deployment has an ephemeral filesystem: the SQLite database, uploaded posters and snapshots live in /tmp and reset when the instance recycles. Deploy with a persistent disk (Docker/Railway/Render/Fly) or set ROYALWEB_DATA_DIR to a durable volume for real data.'
    );
    warnings.push(
      'Background publishing runs from a cron trigger instead of an in-process worker; see docs/DEPLOY.md for the schedule that keeps jobs flowing.'
    );
  }
  if (serverless && !process.env.CRON_SECRET) {
    warnings.push('CRON_SECRET is not set, so the cron endpoints will refuse unauthenticated calls and scheduled publishing will not run.');
  }
  if (!process.env.PUBLIC_BASE_URL && serverless) {
    warnings.push('PUBLIC_BASE_URL is not set — platforms that fetch images by URL will publish text only.');
  }
  if (!process.env.ROYALWEB_ENCRYPTION_KEY && !process.env.ROYALWEB_MASTER_KEY) {
    warnings.push(
      'No master key in the environment (ROYALWEB_ENCRYPTION_KEY / ROYALWEB_MASTER_KEY): one is generated in the data directory, so encrypted credentials cannot be read after a redeploy on an ephemeral host.'
    );
  }

  return {
    platform: detectPlatform(),
    serverless,
    storage,
    dataDir: res.dir,
    dataDirRequested: res.requested,
    dataDirIssue: issue,
    writable: res.writable,
    node: process.version,
    region: region(),
    worker: serverless ? 'cron' : 'in-process',
    warnings,
  };
}
