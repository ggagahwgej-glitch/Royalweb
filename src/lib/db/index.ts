import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { migrations } from './migrations';
import { dataDir, dataDirIssue } from '@/lib/runtime';

/**
 * SQLite persistence layer (real on-disk database, WAL mode).
 * A single connection is cached on globalThis so Next.js dev HMR does not
 * leak file handles.
 *
 * Two deployment realities are handled explicitly here, because both used to
 * surface as an opaque "server-side exception" page:
 *
 *   1. `node:sqlite` exists from Node 22.5 but is only usable without a flag
 *      from Node 22.13. A runtime below that cannot load it at all — the module
 *      is resolved lazily so the app can explain that instead of dying inside
 *      an import.
 *   2. A read-only or missing data directory (a serverless bundle, a volume
 *      that is not mounted, a wrong ROYALWEB_DATA_DIR) makes the first query
 *      throw EROFS/EACCES/EACCES during render. runtime.ts resolves a writable
 *      directory, and any remaining failure is reported with the path, the
 *      Node version and the fix.
 */

/** Minimum Node.js that exposes node:sqlite without --experimental-sqlite. */
export const MIN_NODE = '22.13.0';

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type SqliteCtor = new (file: string) => SqliteDatabase;

// On a serverless host there is no writable project directory; runtime.ts picks
// /tmp there and reports the deployment as ephemeral. `ROYALWEB_DB_PATH` still
// wins for a mounted volume.
const DATA_DIR = dataDir();
const DB_PATH = process.env.ROYALWEB_DB_PATH || path.join(DATA_DIR, 'royalweb.db');

declare global {
  // eslint-disable-next-line no-var
  var __royalwebDb: SqliteDatabase | undefined;
  // eslint-disable-next-line no-var
  var __royalwebDbReady: boolean | undefined;
}

/** Load a Node builtin without a static import, so a missing module is catchable. */
function builtin(id: string): Record<string, unknown> | null {
  const getBuiltin = (process as unknown as { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule;
  if (typeof getBuiltin === 'function') {
    try {
      const mod = getBuiltin.call(process, id) as Record<string, unknown> | undefined;
      if (mod) return mod;
    } catch {
      /* fall through to require */
    }
  }
  try {
    // Works from both CJS and ESM output: resolve relative to a file in cwd.
    const req = createRequire(path.join(process.cwd(), 'royalweb-sqlite-loader.cjs'));
    return req(id) as Record<string, unknown>;
  } catch {
    return null;
  }
}

let sqliteCtor: SqliteCtor | null | undefined;
let sqliteError: string | null = null;

function loadSqlite(): SqliteCtor {
  if (sqliteCtor) return sqliteCtor;
  const mod = builtin('node:sqlite');
  const ctor = mod?.DatabaseSync as SqliteCtor | undefined;
  if (typeof ctor !== 'function') {
    sqliteError =
      `This runtime does not provide "node:sqlite" (Node ${process.version}). ROYALWEB AUTOPILOT needs Node.js ${MIN_NODE} or newer. ` +
      'On Vercel open Project Settings → General → Node.js Version and pick 22.x or 24.x (Vercel discontinued Node 20 on 2026-10-01), then redeploy — "engines": { "node": ">=22.13.0" } in package.json already matches both.';
    throw new Error(sqliteError);
  }
  sqliteCtor = ctor;
  return ctor;
}

/** Capability report for /api/health and `npm run doctor`. Never throws. */
export function sqliteStatus(): { available: boolean; node: string; minNode: string; error: string | null } {
  let available = Boolean(sqliteCtor);
  let error = sqliteError;
  if (!available) {
    try {
      loadSqlite();
      available = true;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return { available, node: process.version, minNode: MIN_NODE, error: available ? null : error };
}

function open(): SqliteDatabase {
  const DatabaseSync = loadSqlite();
  try {
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
    return db as SqliteDatabase;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const issue = dataDirIssue();
    throw new Error(
      `Cannot open the SQLite database at ${DB_PATH}: ${reason}.` +
        (issue ? ` Storage: ${issue}.` : '') +
        ` Fix: set ROYALWEB_DATA_DIR to a writable, persistent directory (Docker/Railway/Render/Fly), or on a serverless host leave it unset so the app uses ${dataDir()}.`
    );
  }
}

function runMigrations(db: SqliteDatabase) {
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

export function getDb(): SqliteDatabase {
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
  return getDb().prepare(sql).run(...(params as never[])) as { changes: number; lastInsertRowid: number | bigint };
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
