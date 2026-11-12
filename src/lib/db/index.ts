import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations';
import { dataDir } from '@/lib/runtime';

/**
 * SQLite persistence layer (real on-disk database, WAL mode).
 * A single connection is cached on globalThis so Next.js dev HMR does not
 * leak file handles.
 */

// On a serverless host there is no writable project directory; runtime.ts picks
// /tmp there and reports the deployment as ephemeral. `ROYALWEB_DB_PATH` still
// wins for a mounted volume.
const DATA_DIR = dataDir();
const DB_PATH = process.env.ROYALWEB_DB_PATH || path.join(DATA_DIR, 'royalweb.db');

declare global {
  // eslint-disable-next-line no-var
  var __royalwebDb: DatabaseSync | undefined;
  // eslint-disable-next-line no-var
  var __royalwebDbReady: boolean | undefined;
}

function open(): DatabaseSync {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  // WAL keeps readers non-blocking; on a single-instance host it is the right
  // trade-off. On a network volume it would need SQLite's shared-memory files,
  // so a remote/mounted disk should use DELETE mode (ROYALWEB_SQLITE_JOURNAL).
  db.exec(`PRAGMA journal_mode = ${process.env.ROYALWEB_SQLITE_JOURNAL === 'delete' ? 'DELETE' : 'WAL'};`);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  runMigrations(db);
  return db;
}

function runMigrations(db: DatabaseSync) {
  const existing = new Set<number>();
  try {
    const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
    rows.forEach((r) => existing.add(Number(r.version)));
  } catch {
    /* table does not exist yet */
  }
  for (const m of migrations) {
    if (existing.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function getDb(): DatabaseSync {
  if (!globalThis.__royalwebDb) {
    globalThis.__royalwebDb = open();
    globalThis.__royalwebDbReady = true;
  }
  return globalThis.__royalwebDb;
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, ...params: unknown[]) {
  return getDb().prepare(sql).run(...(params as never[]));
}

export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function newId(prefix = ''): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function json<T = unknown>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export { DATA_DIR, DB_PATH };
