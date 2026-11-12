import 'server-only';
import { all, get, nowIso } from '@/lib/db';
import { raiseAlert } from '@/lib/alerts';
import { snapshotDue, runScheduledSnapshot } from '@/lib/snapshot';
import { pollDueFeeds } from '@/lib/rss';
import { recycleDueCampaigns } from '@/lib/evergreen';

/**
 * Background supervision.
 *
 * The worker loop cannot alert on its own death, so this runs from a second,
 * independent timer: it watches the heartbeat table, the token expiry column and
 * the snapshot/RSS schedules. If the *whole process* is down nothing inside it
 * can report that — that case needs external monitoring (see docs/ALERTS.md),
 * and the dashboard says so rather than pretending otherwise.
 */

declare global {
  // eslint-disable-next-line no-var
  var __royalwebMonitor: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __royalwebMonitorBusy: boolean | undefined;
}

const MONITOR_MS = 60_000;
const WORKER_STALL_SECONDS = 120;
const TOKEN_ALERT_HOURS = 6;

export interface MonitorResult {
  workerAlive: boolean;
  secondsSinceHeartbeat: number | null;
  alerts: string[];
  snapshot: string | null;
  rss: string | null;
  recycled: number;
}

export async function runMonitor(): Promise<MonitorResult> {
  const result: MonitorResult = {
    workerAlive: true,
    secondsSinceHeartbeat: null,
    alerts: [],
    snapshot: null,
    rss: null,
    recycled: 0,
  };

  // ── worker heartbeat ──────────────────────────────────────────────────────
  const beat = get<{ started_at: string }>(
    'SELECT started_at FROM worker_heartbeats ORDER BY started_at DESC LIMIT 1'
  );
  if (beat) {
    const seconds = Math.round((Date.now() - new Date(beat.started_at).getTime()) / 1000);
    result.secondsSinceHeartbeat = seconds;
    if (seconds > WORKER_STALL_SECONDS) {
      result.workerAlive = false;
      const alert = await raiseAlert({
        code: 'worker_dead',
        title: 'Publishing worker has stopped',
        detail:
          `No worker heartbeat for ${Math.round(seconds / 60)} minutes (last beat ${beat.started_at}). ` +
          'Scheduled posts are not being published. Check that the server process is running and that ' +
          'ROYALWEB_DISABLE_WORKER is not set, then open Diagnostics → Run worker tick.',
        dedupeMinutes: 60,
        meta: { secondsSinceHeartbeat: seconds },
      });
      if (alert.fired) result.alerts.push('worker_dead');
    }
  }

  // ── tokens that can no longer be refreshed ────────────────────────────────
  const deadTokens = all<{ platform_id: string; account_name: string; token_expires_at: string }>(
    `SELECT platform_id, account_name, token_expires_at FROM connected_accounts
      WHERE status IN ('connected','unverified','expired')
        AND token_expires_at IS NOT NULL AND token_expires_at < ?
      ORDER BY token_expires_at LIMIT 10`,
    nowIso()
  );
  for (const token of deadTokens) {
    const alert = await raiseAlert({
      code: 'token_expired',
      title: `${token.platform_id} authorization expired`,
      detail:
        `The stored token for “${token.account_name}” expired at ${token.token_expires_at} and jobs targeting ` +
        `${token.platform_id} will fail until it is reconnected. Open Connected Accounts → Reconnect.`,
      dedupeMinutes: TOKEN_ALERT_HOURS * 60,
      meta: { platformId: token.platform_id, account: token.account_name },
    });
    if (alert.fired) result.alerts.push(`token_expired:${token.platform_id}`);
  }

  // ── scheduled work that must not depend on someone opening a page ─────────
  try {
    if (snapshotDue()) {
      const snap = await runScheduledSnapshot();
      result.snapshot = snap.ok ? snap.fileName ?? 'saved' : `failed: ${snap.error}`;
      if (!snap.ok) {
        await raiseAlert({
          code: 'snapshot_failed',
          title: 'Scheduled database snapshot failed',
          detail: snap.error ?? 'Unknown error while writing the encrypted snapshot.',
          dedupeMinutes: 180,
        });
      }
    }
  } catch (err) {
    result.snapshot = `failed: ${(err as Error).message}`;
  }

  try {
    const polled = await pollDueFeeds(2);
    if (polled.checked) {
      result.rss = `${polled.checked} feed(s) · ${polled.items} new item(s) · ${polled.drafted} draft campaign(s)`;
    }
  } catch (err) {
    result.rss = `failed: ${(err as Error).message}`;
  }

  try {
    result.recycled = await recycleDueCampaigns();
  } catch (err) {
    console.error('[monitor] evergreen recycle failed:', err);
  }

  return result;
}

export function startMonitor() {
  if (globalThis.__royalwebMonitor) return;
  if (process.env.ROYALWEB_DISABLE_WORKER === '1') return;
  globalThis.__royalwebMonitor = setInterval(() => {
    if (globalThis.__royalwebMonitorBusy) return;
    globalThis.__royalwebMonitorBusy = true;
    void runMonitor()
      .catch((err) => console.error('[monitor] failed', err))
      .finally(() => {
        globalThis.__royalwebMonitorBusy = false;
      });
  }, MONITOR_MS);
  console.log('[monitor] background supervisor started (60s interval)');
}
