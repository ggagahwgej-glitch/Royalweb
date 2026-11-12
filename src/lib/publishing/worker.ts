import 'server-only';
import { all, get, run, newId, nowIso } from '@/lib/db';
import { processDueJobs } from './engine';

declare global {
  // eslint-disable-next-line no-var
  var __royalwebWorker: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __royalwebTickBusy: boolean | undefined;
}

const TICK_MS = 20_000;

/**
 * In-process scheduler. It is started once per server process by
 * instrumentation.ts and can also be driven externally through
 * /api/worker/tick (for serverless deployments + cron).
 */
export function startWorker() {
  if (globalThis.__royalwebWorker) return;
  if (process.env.ROYALWEB_DISABLE_WORKER === '1') return;
  globalThis.__royalwebWorker = setInterval(() => {
    void tick('interval').catch((err) => console.error('[worker] tick failed', err));
  }, TICK_MS);
  setTimeout(() => void tick('startup').catch(() => undefined), 1500);
  console.log('[worker] publishing worker started (20s interval)');
}

export async function tick(source: string) {
  if (globalThis.__royalwebTickBusy) return { skipped: true, source };
  globalThis.__royalwebTickBusy = true;
  const heartbeatId = newId();
  run(
    'INSERT INTO worker_heartbeats (id, source, started_at) VALUES (?, ?, ?)',
    heartbeatId,
    source.slice(0, 40),
    nowIso()
  );
  try {
    const recurrence = enqueueRecurrences();
    const result = await processDueJobs(3);
    const verified = await verifyStaleAccounts();
    const finalised = finaliseSettledCampaigns();
    run(
      `UPDATE worker_heartbeats SET finished_at = ?, processed = ?, recovered = ?, recurrence = ?
        WHERE id = ?`,
      nowIso(),
      result.processed,
      result.recovered,
      recurrence,
      heartbeatId
    );
    // Keep the table small — it is a liveness signal, not an audit log.
    run(
      `DELETE FROM worker_heartbeats WHERE id NOT IN
         (SELECT id FROM worker_heartbeats ORDER BY started_at DESC LIMIT 200)`
    );
    return { ...result, recurrence, verified, finalised, source, at: nowIso() };
  } catch (err) {
    run(
      'UPDATE worker_heartbeats SET finished_at = ?, error = ? WHERE id = ?',
      nowIso(),
      String((err as Error).message ?? err).slice(0, 500),
      heartbeatId
    );
    throw err;
  } finally {
    globalThis.__royalwebTickBusy = false;
  }
}

/**
 * Campaigns can be left in `scheduled`/`publishing` when every job ended in a
 * terminal state other than success (permission errors, expired connections,
 * duplicates). Without this sweep they look "in progress" forever.
 */
export function finaliseSettledCampaigns(): number {
  const stuck = all<{ id: string }>(
    `SELECT c.id FROM campaigns c
      WHERE c.status IN ('scheduled','publishing')
        AND EXISTS (SELECT 1 FROM publishing_jobs j WHERE j.campaign_id = c.id)
        AND NOT EXISTS (
          SELECT 1 FROM publishing_jobs j WHERE j.campaign_id = c.id
            AND j.status IN ('scheduled','processing','waiting_approval','manual_required')
        )`
  );
  let changed = 0;
  for (const campaign of stuck) {
    const published = get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM publishing_jobs WHERE campaign_id = ? AND status = 'published'",
      campaign.id
    );
    run(
      'UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?',
      Number(published?.c || 0) > 0 ? 'completed' : 'failed',
      nowIso(),
      campaign.id
    );
    changed += 1;
  }
  return changed;
}

/**
 * Daily/weekly campaigns. Recurring cycles are enqueued at the configured
 * interval; the publishing engine's duplicate-content guard stops identical
 * copy from being republished inside the configured window.
 */
function enqueueRecurrences() {
  const due = all<{
    id: string;
    recurrence: string;
    next_recurrence_at: string;
    user_id: string;
  }>(
    `SELECT id, recurrence, next_recurrence_at, user_id FROM campaigns
      WHERE recurrence IN ('daily','weekly') AND next_recurrence_at IS NOT NULL
        AND next_recurrence_at <= ? AND status IN ('completed','scheduled','publishing','failed')`,
    nowIso()
  );
  let created = 0;
  for (const campaign of due) {
    const contents = all<{ id: string; platform_id: string }>(
      `SELECT gc.id, gc.platform_id FROM generated_contents gc
        JOIN platforms p ON p.id = gc.platform_id
       WHERE gc.campaign_id = ? AND gc.status = 'approved' AND p.automation != 'manual'`,
      campaign.id
    );
    for (const content of contents) {
      const account = get<{ id: string }>(
        `SELECT id FROM connected_accounts WHERE platform_id = ? AND user_id = ? AND status = 'connected' LIMIT 1`,
        content.platform_id,
        campaign.user_id
      );
      const key = `recur:${campaign.id}:${content.platform_id}:${campaign.next_recurrence_at}`;
      const exists = get<{ id: string }>('SELECT id FROM publishing_jobs WHERE idempotency_key = ?', key);
      if (exists) continue;
      run(
        `INSERT INTO publishing_jobs (id, campaign_id, platform_id, account_id, media_id, content_id,
           scheduled_at, status, attempts, max_attempts, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, 'scheduled', 0, 3, ?, ?, ?)`,
        newId(),
        campaign.id,
        content.platform_id,
        account?.id ?? null,
        content.id,
        campaign.next_recurrence_at,
        key,
        nowIso(),
        nowIso()
      );
      created += 1;
    }
    const hours = campaign.recurrence === 'daily' ? 24 : 168;
    run(
      'UPDATE campaigns SET next_recurrence_at = ?, status = ?, updated_at = ? WHERE id = ?',
      new Date(new Date(campaign.next_recurrence_at).getTime() + hours * 3600_000).toISOString(),
      'scheduled',
      nowIso(),
      campaign.id
    );
  }
  return created;
}

/** Re-check tokens that are close to expiry so the dashboard can warn early. */
async function verifyStaleAccounts() {
  const expiring = all<{ id: string; platform_id: string }>(
    `SELECT id, platform_id FROM connected_accounts
      WHERE status = 'connected' AND token_expires_at IS NOT NULL AND token_expires_at < ?
      LIMIT 10`,
    nowIso()
  );
  for (const account of expiring) {
    run(
      'UPDATE connected_accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?',
      'expired',
      'Access token expired. Reconnect to resume publishing.',
      nowIso(),
      account.id
    );
  }
  return expiring.length;
}
