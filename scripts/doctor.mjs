#!/usr/bin/env node
/**
 * Preflight / self-diagnosis for the deployment environment.
 *
 *   npm run doctor            → human-readable report
 *   npm run doctor -- --json  → machine-readable
 *
 * It answers the three questions that used to produce an opaque
 * "Application error: a server-side exception" page in production:
 *
 *   1. Does this Node runtime provide node:sqlite? (needs Node >= 22.13)
 *   2. Is the data directory writable — and is it where ROYALWEB_DATA_DIR says?
 *   3. Can the master key be resolved and does AES-256-GCM round-trip?
 *
 * Nothing here writes to the database, so it is safe to run on a live host.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createHash } from 'node:crypto';

const MIN_NODE = '22.13.0';
const jsonMode = process.argv.includes('--json');

const platform = process.env.VERCEL
  ? 'vercel'
  : process.env.NETLIFY
    ? 'netlify'
    : process.env.AWS_LAMBDA_FUNCTION_NAME
      ? 'lambda'
      : 'node';
const serverless = platform !== 'node';

// In --json mode every human note goes to stderr so stdout stays parseable.
const note = (...args) => (jsonMode ? console.error(...args) : console.log(...args));

const results = [];
function check(id, ok, detail, hint) {
  results.push({ id, ok, detail, hint: ok ? null : hint });
  return ok;
}

// ── 1. Node / node:sqlite ────────────────────────────────────────────────────
const [major, minor] = process.version.replace(/^v/, '').split('.').map(Number);
const nodeNewEnough = major > 22 || (major === 22 && minor >= 13);
let sqliteOk = false;
let sqliteDetail = 'not available';
try {
  const getBuiltin = process.getBuiltinModule;
  const mod = typeof getBuiltin === 'function' ? getBuiltin('node:sqlite') : null;
  sqliteOk = Boolean(mod?.DatabaseSync);
  sqliteDetail = sqliteOk ? 'database API available' : 'node:sqlite did not expose DatabaseSync';
} catch (err) {
  sqliteDetail = err.message;
}
check(
  'node:sqlite',
  sqliteOk,
  `${process.version.replace(/^v/, '')} · ${sqliteDetail}`,
  `Node.js ${MIN_NODE}+ is required (node:sqlite is only unflagged from 22.13). Vercel: Project Settings → General → Node.js Version → 22.x or 24.x.`
);
if (!nodeNewEnough && sqliteOk) {
  console.warn(`! Node ${process.version} is below the supported floor (${MIN_NODE}).`);
}

// ── 2. Data directory ────────────────────────────────────────────────────────
function probe(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(file, 'ok');
    fs.rmSync(file, { force: true });
    return null;
  } catch (err) {
    return err.message;
  }
}

const configured = process.env.ROYALWEB_DATA_DIR?.trim() || null;
const candidates = [];
if (configured) candidates.push(configured);
candidates.push(serverless ? path.join('/tmp', 'royalweb') : path.join(process.cwd(), 'data'));
candidates.push(path.join('/tmp', 'royalweb'), path.join(os.tmpdir(), 'royalweb'));
const unique = [...new Set(candidates)];

let dataDir = unique.find((dir) => probe(dir) === null) ?? null;
const dataDirError = dataDir ? null : probe(unique[0]);
check(
  'data directory',
  Boolean(dataDir) && (!configured || dataDir === configured),
  dataDir
    ? `${dataDir}${configured && dataDir !== configured ? ` (requested ${configured} — not writable, fell back)` : ''}`
    : `no writable directory (${dataDirError})`,
  'Set ROYALWEB_DATA_DIR to a writable, persistent volume, or on a serverless host leave it unset so /tmp/royalweb is used.'
);

const storage =
  dataDir && ['/tmp', '/var/tmp', os.tmpdir()].some((root) => dataDir === root || dataDir.startsWith(`${root}${path.sep}`))
    ? 'ephemeral'
    : serverless
      ? 'ephemeral'
      : 'persistent';
// Ephemeral storage is a documented property of serverless hosts, not a
// misconfiguration: report it as a warning so CI on Vercel still passes.
const warnings = [];
if (storage === 'ephemeral') {
  warnings.push(
    `storage is ephemeral${serverless ? ' on this host' : ''} — the database and uploads reset when the instance recycles. ` +
      'Use a persistent disk (Docker, Railway, Render, Fly) for real data.'
  );
  note(`\n! ${warnings[0]}\n`);
}

// ── 3. Database file ─────────────────────────────────────────────────────────
const dbPath = process.env.ROYALWEB_DB_PATH || (dataDir ? path.join(dataDir, 'royalweb.db') : null);
let migrations = 0;
let indexes = 0;
if (sqliteOk && dbPath && fs.existsSync(dbPath)) {
  try {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      migrations = Number(db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get()?.c ?? 0);
    } catch {
      migrations = 0;
    }
    try {
      indexes = Number(
        db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").get()?.c ?? 0
      );
    } catch {
      indexes = 0;
    }
    db.close();
  } catch (err) {
    check('database', false, err.message, 'Check ROYALWEB_DATA_DIR / ROYALWEB_DB_PATH permissions.');
  }
}
if (dbPath && sqliteOk) {
  if (fs.existsSync(dbPath)) {
    check('database', true, `${dbPath} · ${migrations} migrations · ${indexes} indexes`);
  } else {
    // A fresh clone has no database yet; first start creates and migrates it.
    warnings.push(`no database at ${dbPath} yet — it is created and migrated on first start (or run \`npm run db:migrate\`).`);
    note(`\n! ${warnings[warnings.length - 1]}\n`);
  }
}

// ── 4. Master key / encryption ───────────────────────────────────────────────
function readKey() {
  for (const name of ['ROYALWEB_ENCRYPTION_KEY', 'ROYALWEB_MASTER_KEY']) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error(`${name} decodes to ${buf.length} bytes, expected 32`);
    return { key: buf, source: name };
  }
  const file = path.join(dataDir ?? path.join(process.cwd(), 'data'), '.keys', 'master.key');
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file);
    if (raw.length === 32) return { key: raw, source: `file ${file}` };
    throw new Error(`${file} is ${raw.length} bytes, expected 32`);
  }
  return null;
}

let keyInfo = null;
try {
  keyInfo = readKey();
} catch (err) {
  check('master key', false, err.message, 'Provide 32 bytes as hex (openssl rand -hex 32) or base64 (openssl rand -base64 32).');
}
if (!keyInfo) {
  note(
    `\n! no master key found — one will be generated at ${path.join(
      dataDir ?? path.join(process.cwd(), 'data'),
      '.keys',
      'master.key'
    )} on first use.${serverless ? ' On this host that file is discarded with the instance: set ROYALWEB_ENCRYPTION_KEY.' : ''}\n`
  );
}
if (keyInfo) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyInfo.key, iv);
  const ciphertext = Buffer.concat([cipher.update('royalweb-doctor', 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyInfo.key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  check('encryption', plain === 'royalweb-doctor', `AES-256-GCM round-trip ok · key from ${keyInfo.source}`, 'The master key is corrupt.');
  if (!keyInfo.source.startsWith('ROYALWEB_') && serverless) {
    console.warn(
      `! The master key comes from ${keyInfo.source}. On an ephemeral host that file disappears with the instance — set ROYALWEB_ENCRYPTION_KEY so saved credentials stay readable.`
    );
  }
  note(`  fingerprint ${createHash('sha256').update(keyInfo.key).digest('hex').slice(0, 12)} (non-secret)`);
}

// ── report ───────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const report = {
  ok: failed.length === 0,
  node: process.version,
  platform,
  serverless,
  storage,
  dataDir,
  dbPath,
  migrations,
  indexes,
  keySource: keyInfo?.source ?? null,
  warnings,
  checks: results,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nROYALWEB doctor · node ${process.version} · ${platform}${serverless ? ' (serverless)' : ''}\n`);
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.id.padEnd(20)} ${r.detail}`);
    if (r.hint) console.log(`    → ${r.hint}`);
  }
  console.log('');
  if (failed.length) {
    console.log(`${failed.length} check(s) failed — fix the items marked ✗ above.\n`);
  } else {
    console.log('All environment checks passed.\n');
  }
}

process.exitCode = failed.length ? 1 : 0;
