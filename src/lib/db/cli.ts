/**
 * Standalone database CLI (bundled by scripts/db.mjs).
 * Deliberately free of `server-only` / Next imports so it can run in plain Node.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { migrations } from './migrations';
import { dataDir, dataDirIssue } from '../runtime';

type DatabaseSync = import('node:sqlite').DatabaseSync;

/** Same lazy resolution as the app: an unsupported Node gets a clear message. */
function loadSqlite(): typeof import('node:sqlite') {
  const getBuiltin = (process as unknown as { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule;
  try {
    const mod =
      (typeof getBuiltin === 'function' ? (getBuiltin.call(process, 'node:sqlite') as typeof import('node:sqlite')) : undefined) ??
      (createRequire(path.join(process.cwd(), 'royalweb-sqlite-loader.cjs'))('node:sqlite') as typeof import('node:sqlite'));
    if (!mod?.DatabaseSync) throw new Error('node:sqlite present but DatabaseSync missing');
    return mod;
  } catch (err) {
    console.error(
      `✗ node:sqlite is unavailable in this Node.js runtime (${process.version}): ${err instanceof Error ? err.message : String(err)}\n` +
        '  Node.js 22.13 or newer is required (node:sqlite is only unflagged from 22.13).'
    );
    process.exit(1);
  }
}

const { DatabaseSync } = loadSqlite();
const DATA_DIR = dataDir();
const DB_PATH = process.env.ROYALWEB_DB_PATH || path.join(DATA_DIR, 'royalweb.db');

if (dataDirIssue()) console.warn(`! ${dataDirIssue()}`);

function applyMigrations(db: DatabaseSync) {
  const applied = new Set<number>();
  try {
    const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
    rows.forEach((r) => applied.add(Number(r.version)));
  } catch {
    /* first run */
  }
  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      console.log(`• migration ${migration.version} ${migration.name} already applied`);
      continue;
    }
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
      db.exec('COMMIT');
      console.log(`✓ applied migration ${migration.version} ${migration.name}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

const command = process.argv[2] || 'migrate';

if (command === 'reset') {
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${DB_PATH}${suffix}`;
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  console.log(`✓ deleted ${DB_PATH}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
applyMigrations(db);

const counts = {
  platforms: (db.prepare('SELECT COUNT(*) AS c FROM platforms').get() as { c: number }).c,
  users: (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c,
  campaigns: (db.prepare('SELECT COUNT(*) AS c FROM campaigns').get() as { c: number }).c,
  jobs: (db.prepare('SELECT COUNT(*) AS c FROM publishing_jobs').get() as { c: number }).c,
};

console.log(`\nDatabase: ${DB_PATH}`);
console.log(`Platforms: ${counts.platforms}/25 · Users: ${counts.users} · Campaigns: ${counts.campaigns} · Jobs: ${counts.jobs}`);
if (counts.platforms === 0) {
  console.log('\nPlatform catalogue is seeded automatically when the app starts (ensureBootstrap).');
}
if (counts.users === 0) {
  console.log('No administrator yet — set ROYALWEB_ADMIN_EMAIL/PASSWORD or use the first-run setup screen.');
}
