/**
 * Standalone database CLI (bundled by scripts/db.mjs).
 * Deliberately free of `server-only` / Next imports so it can run in plain Node.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations';

const DATA_DIR = process.env.ROYALWEB_DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = process.env.ROYALWEB_DB_PATH || path.join(DATA_DIR, 'royalweb.db');

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
