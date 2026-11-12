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
 *
 * Nothing here is ever presented as durable when it is not.
 */
import fs from 'node:fs';
import path from 'node:path';

export type RuntimePlatform = 'vercel' | 'netlify' | 'lambda' | 'node';
export type StorageMode = 'persistent' | 'ephemeral';

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

function writable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Directory that holds the database, uploads and snapshots.
 * `ROYALWEB_DATA_DIR` always wins — on a serverless host you can point it at a
 * mounted volume if the platform ever offers one.
 */
export function dataDir(): string {
  const configured = process.env.ROYALWEB_DATA_DIR?.trim();
  if (configured) return configured;
  if (isServerless()) return path.join('/tmp', 'royalweb');
  return path.join(process.cwd(), 'data');
}

/** True when the data directory survives restarts and is shared by all instances. */
export function storageMode(): StorageMode {
  const dir = dataDir();
  if (process.env.ROYALWEB_DATA_DIR?.trim()) {
    // An explicit path is only "persistent" if it is stable across instances.
    return dir.startsWith('/tmp') || dir.startsWith('/var/tmp') ? 'ephemeral' : 'persistent';
  }
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
  writable: boolean;
  node: string;
  region: string | null;
  worker: 'in-process' | 'cron';
  warnings: string[];
}

export function runtimeReport(): RuntimeReport {
  const dir = dataDir();
  const storage = storageMode();
  const serverless = isServerless();
  const warnings: string[] = [];

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

  return {
    platform: detectPlatform(),
    serverless,
    storage,
    dataDir: dir,
    writable: writable(dir),
    node: process.version,
    region: region(),
    worker: serverless ? 'cron' : 'in-process',
    warnings,
  };
}
