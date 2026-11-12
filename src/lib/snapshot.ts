import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, DATA_DIR, DB_PATH, get, getDb, newId, nowIso, run } from '@/lib/db';
import { sealWithPassphrase } from '@/lib/crypto';
import { getSecret, setSecret } from '@/lib/secrets';

/**
 * Full-database snapshots.
 *
 * A credentials backup is not a disaster-recovery plan: campaigns, jobs,
 * published history, analytics and the opt-out list live in the database. A
 * snapshot therefore takes a consistent copy of the whole SQLite file
 * (`VACUUM INTO`, which is safe on a live database), encrypts it with a
 * passphrase-derived key and writes it next to the data directory.
 *
 * Restore is intentionally offline (`npm run db:restore`): swapping a SQLite
 * file under a running server corrupts it, and a "restore" button that can
 * destroy the live installation in one click is not a feature.
 */

export type SnapshotTrigger = 'manual' | 'schedule' | 'pre-restore';
export type SnapshotSchedule = 'off' | 'daily' | 'weekly';

const SECRET_PASSPHRASE = 'snapshot.passphrase';
const SECRET_SCHEDULE = 'snapshot.schedule';
const SECRET_RETENTION = 'snapshot.retention';

export const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');

export interface SnapshotRow {
  id: string;
  fileName: string;
  bytes: number;
  sha256: string;
  trigger: string;
  tables: Record<string, number>;
  createdAt: string;
}

const TABLES = [
  'users',
  'user_settings',
  'workspaces',
  'workspace_settings',
  'platforms',
  'connected_accounts',
  'campaigns',
  'media_assets',
  'generated_contents',
  'publishing_jobs',
  'published_posts',
  'publishing_logs',
  'manual_tasks',
  'scheduled_tasks',
  'email_messages',
  'email_suppressions',
  'email_replies',
  'email_send_daily',
  'rss_feeds',
  'rss_items',
  'alert_events',
  'audit_logs',
  'ai_activity_logs',
];

export function snapshotConfig() {
  const passphrase = getSecret(SECRET_PASSPHRASE) ?? '';
  const schedule = (getSecret(SECRET_SCHEDULE) ?? 'off') as SnapshotSchedule;
  const retention = Number(getSecret(SECRET_RETENTION) ?? 14) || 14;
  return {
    configured: passphrase.length >= 12,
    passphraseLength: passphrase.length,
    schedule: ['off', 'daily', 'weekly'].includes(schedule) ? schedule : 'off',
    retention: Math.min(Math.max(retention, 1), 90),
    scheduleIntervalHours: schedule === 'daily' ? 24 : schedule === 'weekly' ? 168 : 0,
  };
}

export function writeSnapshotConfig(input: {
  passphrase?: string;
  schedule?: SnapshotSchedule;
  retention?: number;
  userId?: string;
}) {
  if (input.passphrase !== undefined && input.passphrase !== '') {
    if (input.passphrase.length < 12) throw new Error('Snapshot passphrase must be at least 12 characters.');
    setSecret(SECRET_PASSPHRASE, input.passphrase, input.userId);
  }
  if (input.schedule !== undefined) setSecret(SECRET_SCHEDULE, input.schedule, input.userId);
  if (input.retention !== undefined) {
    setSecret(SECRET_RETENTION, String(Math.min(Math.max(Math.round(input.retention), 1), 90)), input.userId);
  }
  return snapshotConfig();
}

function tableCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    try {
      const row = get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`);
      counts[table] = Number(row?.c ?? 0);
    } catch {
      counts[table] = 0; // table absent in an older schema — recorded as 0, never invented
    }
  }
  return counts;
}

export interface SnapshotResult {
  ok: boolean;
  id?: string;
  fileName?: string;
  bytes?: number;
  error?: string;
  tables?: Record<string, number>;
}

export function createSnapshot(input: { trigger: SnapshotTrigger; passphrase?: string }): SnapshotResult {
  const config = snapshotConfig();
  const passphrase = input.passphrase || getSecret(SECRET_PASSPHRASE) || '';
  if (passphrase.length < 12) {
    return {
      ok: false,
      error:
        'No snapshot passphrase is set. Add one in Settings → Snapshots; without it the encrypted file could never be opened again.',
    };
  }

  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
  const stamp = nowIso().replace(/[:.]/g, '-');
  const id = newId();
  const fileName = `royalweb-snapshot-${stamp}.rwbak`;
  const target = path.join(SNAPSHOT_DIR, fileName);
  const tmp = path.join(SNAPSHOT_DIR, `.tmp-${id}.db`);

  try {
    // VACUUM INTO writes a consistent copy without locking the live database
    // for writes longer than the copy itself.
    getDb().exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buffer = fs.readFileSync(tmp);
    const sealed = sealWithPassphrase(buffer.toString('base64'), passphrase, {
      format: 'royalweb-snapshot',
      version: 1,
      meta: {
        createdAt: nowIso(),
        trigger: input.trigger,
        bytes: buffer.length,
        source: path.basename(DB_PATH),
        note: 'Encrypted SQLite snapshot. Restore offline with: npm run db:restore -- <file>',
      },
    });
    const text = JSON.stringify(sealed);
    fs.writeFileSync(target, text, { mode: 0o600 });
    const tables = tableCounts();
    const sha256Buffer = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');
    run(
      `INSERT INTO snapshots (id, file_name, bytes, sha256, scope, trigger, tables_json, created_at)
       VALUES (?, ?, ?, ?, 'full', ?, ?, ?)`,
      id,
      fileName,
      Buffer.byteLength(text),
      sha256Buffer(buffer),
      input.trigger,
      JSON.stringify(tables),
      nowIso()
    );
    return { ok: true, id, fileName, bytes: Buffer.byteLength(text), tables };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export function listSnapshots(limit = 20): SnapshotRow[] {
  return all<Record<string, unknown>>('SELECT * FROM snapshots ORDER BY created_at DESC LIMIT ?', limit).map((r) => ({
    id: String(r.id),
    fileName: String(r.file_name),
    bytes: Number(r.bytes),
    sha256: String(r.sha256),
    trigger: String(r.trigger),
    tables: JSON.parse(String(r.tables_json ?? '{}')) as Record<string, number>,
    createdAt: String(r.created_at),
  }));
}

export function snapshotFile(id: string): { path: string; fileName: string } | null {
  const row = get<{ file_name: string }>('SELECT file_name FROM snapshots WHERE id = ?', id);
  if (!row) return null;
  const filePath = path.join(SNAPSHOT_DIR, path.basename(row.file_name));
  if (!fs.existsSync(filePath)) return null;
  return { path: filePath, fileName: row.file_name };
}

export function deleteSnapshot(id: string) {
  const row = get<{ file_name: string }>('SELECT file_name FROM snapshots WHERE id = ?', id);
  if (!row) return false;
  try {
    fs.rmSync(path.join(SNAPSHOT_DIR, path.basename(row.file_name)), { force: true });
  } catch {
    /* ignore */
  }
  run('DELETE FROM snapshots WHERE id = ?', id);
  return true;
}

export function pruneSnapshots(keep = snapshotConfig().retention) {
  const rows = listSnapshots(500);
  const removed: string[] = [];
  for (const row of rows.slice(keep)) {
    if (row.trigger === 'manual') continue; // never delete something a person made on purpose
    if (deleteSnapshot(row.id)) removed.push(row.fileName);
  }
  return removed;
}

export function snapshotDue(): boolean {
  const config = snapshotConfig();
  if (config.scheduleIntervalHours === 0 || !config.configured) return false;
  const last = get<{ created_at: string }>(
    "SELECT created_at FROM snapshots WHERE trigger = 'schedule' ORDER BY created_at DESC LIMIT 1"
  );
  if (!last) return true;
  const ageHours = (Date.now() - new Date(last.created_at).getTime()) / 3_600_000;
  return ageHours >= config.scheduleIntervalHours;
}

export async function runScheduledSnapshot(): Promise<SnapshotResult> {
  const result = createSnapshot({ trigger: 'schedule' });
  if (result.ok) pruneSnapshots();
  return result;
}
