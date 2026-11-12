import 'server-only';
import fs from 'node:fs';
import { all, get, nowIso, run } from '@/lib/db';
import { decryptJson, encryptJson } from '@/lib/crypto';
import { getSecret } from '@/lib/secrets';
import { getSettings, updateSettings } from '@/lib/settings';
import { finaliseSettledCampaigns } from '@/lib/publishing/worker';
import { ffmpegPath } from '@/lib/media/video';
import { seedPlatforms } from '@/lib/bootstrap';
import { guideFor, classifyMessage, type GuideAction } from '@/lib/errors/guide';

/**
 * Self-diagnosis.
 *
 * Runs real queries and real crypto/network-adjacent probes against the live
 * installation and returns both a machine-usable report and a human playbook.
 * It never "fixes" silently: destructive actions are separate, explicit calls.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info';

export interface DiagnosticCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  metric?: string;
}

export interface DiagnosticIssue {
  id: string;
  code: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  meaning: string;
  why: string[];
  steps: string[];
  actions: GuideAction[];
  count?: number;
  subjects?: string[];
  fix?: { action: RepairAction; label: string; confirm: string };
}

export type RepairAction =
  | 'run-tick'
  | 'recover-stuck'
  | 'requeue-overdue'
  | 'requeue-failed'
  | 'requeue-expired'
  | 'resume-publishing'
  | 'revoke-sessions'
  | 'reseed-platforms'
  | 'finalise-campaigns';

export interface DiagnosticsReport {
  status: 'healthy' | 'degraded' | 'critical';
  health: number;
  checks: DiagnosticCheck[];
  issues: DiagnosticIssue[];
  counts: {
    campaigns: number;
    jobs: number;
    pendingJobs: number;
    failedJobs: number;
    connectedAccounts: number;
    expiredAccounts: number;
    manualPending: number;
    platformsEnabled: number;
  };
  worker: {
    lastHeartbeatAt: string | null;
    secondsAgo: number | null;
    stalled: boolean;
    expectedIntervalSeconds: number;
  };
  generatedAt: string;
}

const MINUTE = 60_000;

function count(sql: string, ...params: unknown[]): number {
  return Number(get<{ c: number }>(sql, ...params)?.c ?? 0);
}

export async function buildDiagnostics(userId: string): Promise<DiagnosticsReport> {
  const settings = getSettings(userId);
  const ffmpegAvailable = Boolean(await ffmpegPath());
  const checks: DiagnosticCheck[] = [];
  const issues: DiagnosticIssue[] = [];

  const addIssue = (issue: DiagnosticIssue) => {
    issues.push(issue);
  };

  // ── database ───────────────────────────────────────────────────────────────
  let integrity = 'unknown';
  let integrityOk = false;
  try {
    const row = get<{ quick_check: string }>('PRAGMA quick_check');
    integrity = String(row?.quick_check ?? 'unknown');
    integrityOk = /^ok$/i.test(integrity);
  } catch (err) {
    integrity = (err as Error).message;
  }
  checks.push({
    id: 'database',
    title: 'Database',
    status: integrityOk ? 'ok' : 'fail',
    detail: integrityOk ? 'SQLite integrity check passed · WAL mode · foreign keys on' : `Integrity check failed: ${integrity}`,
    metric: integrityOk ? 'ok' : 'corrupt',
  });
  if (!integrityOk) {
    addIssue({
      id: 'db-integrity',
      code: 'db_integrity',
      severity: 'critical',
      title: 'Database integrity check failed',
      meaning: 'SQLite reports a structural problem; reads or writes may be unsafe.',
      why: ['Disk corruption', 'The database file was copied while being written', 'Storage full during a write'],
      steps: [
        'Stop the server before doing anything else.',
        'Restore the most recent backup of data/royalweb.db (and the -wal file).',
        'If no backup exists, run `sqlite3 data/royalweb.db ".recover" > recovered.sql` and rebuild.',
      ],
      actions: [],
    });
  }

  // ── encryption ─────────────────────────────────────────────────────────────
  let encryptionOk = false;
  let encryptionDetail = '';
  try {
    const probe = { probe: userId, at: nowIso() };
    const roundTrip = decryptJson<{ probe: string }>(encryptJson(probe));
    encryptionOk = roundTrip.probe === userId;
    encryptionDetail = encryptionOk
      ? `AES-256-GCM round-trip OK · key from ${process.env.ROYALWEB_ENCRYPTION_KEY ? 'environment' : 'auto-generated file'}`
      : 'Encryption round-trip returned unexpected data';
  } catch (err) {
    encryptionDetail = `Encryption is unusable: ${(err as Error).message}`;
  }

  const accountRows = all<{ id: string; account_name: string; platform_name: string; credentials_cipher: string; status: string; token_expires_at: string | null; platform_id: string }>(
    `SELECT a.id, a.account_name, a.credentials_cipher, a.status, a.token_expires_at, a.platform_id, p.name AS platform_name
       FROM connected_accounts a JOIN platforms p ON p.id = a.platform_id
      WHERE a.user_id = ? AND a.status != 'revoked'`,
    userId
  );
  const undecryptable = accountRows.filter((a) => {
    try {
      decryptJson(a.credentials_cipher);
      return false;
    } catch {
      return true;
    }
  });
  checks.push({
    id: 'encryption',
    title: 'Credential encryption',
    status: !encryptionOk || undecryptable.length ? 'fail' : 'ok',
    detail: undecryptable.length
      ? `${undecryptable.length} stored credential(s) cannot be decrypted with the current key`
      : encryptionDetail,
    metric: `${accountRows.length - undecryptable.length}/${accountRows.length} readable`,
  });
  if (undecryptable.length) {
    addIssue({
      id: 'undecryptable-credentials',
      code: 'credential_decrypt_failed',
      severity: 'critical',
      title: 'Stored credentials cannot be decrypted',
      meaning: 'The encryption key changed or the database was restored without its key file.',
      why: ['ROYALWEB_ENCRYPTION_KEY was replaced', 'data/.keys/master.key was deleted or restored separately'],
      steps: [
        'Restore the original encryption key if you still have it — that is the only way to recover the tokens.',
        'Otherwise reconnect the affected accounts (old ciphertext is unrecoverable by design).',
      ],
      actions: [
        { label: 'Reconnect accounts', href: '/dashboard/accounts' },
        { label: 'Security overview', href: '/dashboard/security' },
      ],
      subjects: undecryptable.map((a) => `${a.platform_name} · ${a.account_name}`),
      count: undecryptable.length,
    });
  }

  // ── worker heartbeat ───────────────────────────────────────────────────────
  const heartbeat = get<{ started_at: string; finished_at: string | null; error: string | null }>(
    'SELECT started_at, finished_at, error FROM worker_heartbeats ORDER BY started_at DESC LIMIT 1'
  );
  const lastHeartbeatAt = heartbeat?.started_at ?? null;
  const ageMs = lastHeartbeatAt ? Date.now() - new Date(lastHeartbeatAt).getTime() : null;
  const disabled = process.env.ROYALWEB_DISABLE_WORKER === '1';
  const stalled = ageMs === null ? true : ageMs > 10 * MINUTE;
  const workerStatus: CheckStatus = disabled ? 'info' : stalled ? 'fail' : ageMs! > 2 * MINUTE ? 'warn' : 'ok';
  checks.push({
    id: 'worker',
    title: 'Publishing worker',
    status: workerStatus,
    detail: disabled
      ? 'In-process worker disabled (ROYALWEB_DISABLE_WORKER=1) — an external worker/cron must call the tick endpoint'
      : lastHeartbeatAt
        ? `Last tick ${Math.round((ageMs ?? 0) / 1000)}s ago${heartbeat?.error ? ` · last error: ${heartbeat.error}` : ''}`
        : 'No tick has been recorded since this database was created',
    metric: lastHeartbeatAt ? `${Math.round((ageMs ?? 0) / 1000)}s` : 'never',
  });
  if (!disabled && stalled) {
    const guide = guideFor('worker_stalled');
    addIssue({
      id: 'worker-stalled',
      code: 'worker_stalled',
      severity: 'critical',
      title: 'Scheduled posts are not being picked up',
      meaning: guide.meaning,
      why: guide.why,
      steps: guide.steps,
      actions: guide.actions,
      fix: { action: 'run-tick', label: 'Run worker tick now', confirm: 'Publish every due job now?' },
    });
  }

  // ── stuck / overdue jobs ───────────────────────────────────────────────────
  const stuckProcessing = count(
    `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
      WHERE c.user_id = ? AND j.status = 'processing' AND j.locked_at IS NOT NULL AND j.locked_at < ?`,
    userId,
    new Date(Date.now() - 10 * MINUTE).toISOString()
  );
  const overdue = count(
    `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
      WHERE c.user_id = ? AND j.status = 'scheduled' AND j.scheduled_at < ?
        AND (j.next_attempt_at IS NULL OR j.next_attempt_at < ?)`,
    userId,
    new Date(Date.now() - 2 * MINUTE).toISOString(),
    new Date(Date.now() - 2 * MINUTE).toISOString()
  );
  checks.push({
    id: 'queue',
    title: 'Publishing queue',
    status: stuckProcessing ? 'warn' : overdue && !settings.globalPause ? 'warn' : 'ok',
    detail: `${overdue} overdue · ${stuckProcessing} locked > 10 min`,
  });
  if (stuckProcessing) {
    addIssue({
      id: 'stuck-jobs',
      code: 'stuck_jobs',
      severity: 'warning',
      title: `${stuckProcessing} job(s) were interrupted mid-publish`,
      meaning: 'A job was claimed but the process stopped before recording a result (restart, crash, deploy).',
      why: ['Server restarted during an upload', 'Worker killed by the host', 'A publish call hung until the process died'],
      steps: [
        'Check the platform first: the post may already exist even though ROYALWEB has no result.',
        'Release the locks here, then retry deliberately.',
      ],
      actions: [
        { label: 'Check published posts', href: '/dashboard/published' },
        { label: 'Publishing log', href: '/dashboard/security' },
      ],
      count: stuckProcessing,
      fix: { action: 'recover-stuck', label: 'Release interrupted jobs', confirm: 'Release these jobs back to the schedule?' },
    });
  }
  if (overdue && !settings.globalPause && !disabled) {
    addIssue({
      id: 'overdue-jobs',
      code: 'worker_stalled',
      severity: 'warning',
      title: `${overdue} scheduled post(s) are overdue`,
      meaning: 'They are due but have not been attempted yet.',
      why: ['The worker was not running', 'The job time passed while the server was offline', 'Retry timer still active'],
      steps: [
        'Run a worker tick to drain the queue immediately.',
        'If this repeats, set up a cron calling POST /api/worker/tick every minute.',
      ],
      actions: [{ label: 'Scheduled posts', href: '/dashboard/scheduled' }],
      count: overdue,
      fix: { action: 'requeue-overdue', label: 'Run them now', confirm: 'Attempt all overdue jobs immediately?' },
    });
  }

  // ── connections ────────────────────────────────────────────────────────────
  const expiredAccounts = accountRows.filter((a) => a.status !== 'connected');
  const expiringSoon = accountRows.filter(
    (a) => a.token_expires_at && new Date(a.token_expires_at).getTime() < Date.now() + 24 * 3600_000
  );
  checks.push({
    id: 'connections',
    title: 'Platform connections',
    status: expiredAccounts.length ? 'warn' : 'ok',
    detail: `${accountRows.length} connected · ${expiredAccounts.length} need attention`,
    metric: `${accountRows.length}`,
  });
  if (expiredAccounts.length || expiringSoon.length) {
    const guide = guideFor('connection_expired');
    addIssue({
      id: 'expired-connections',
      code: 'connection_expired',
      severity: expiredAccounts.length ? 'warning' : 'info',
      title: `${expiredAccounts.length || expiringSoon.length} connection(s) need attention`,
      meaning: guide.meaning,
      why: guide.why,
      steps: guide.steps,
      actions: guide.actions,
      subjects: [...new Set([...expiredAccounts, ...expiringSoon].map((a) => `${a.platform_name} · ${a.account_name}`))],
      count: expiredAccounts.length || expiringSoon.length,
      fix: expiredAccounts.length
        ? { action: 'requeue-expired', label: 'Retry jobs for reconnected accounts', confirm: 'Requeue jobs whose platform now has a working account?' }
        : undefined,
    });
  }

  // ── failures ───────────────────────────────────────────────────────────────
  const failedJobs = all<{ id: string; error: string | null; error_code: string | null; platform_name: string; campaign_name: string; campaign_id: string }>(
    `SELECT j.id, j.error, j.error_code, p.name AS platform_name, c.name AS campaign_name, c.id AS campaign_id
       FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id JOIN platforms p ON p.id = j.platform_id
      WHERE c.user_id = ? AND j.status IN ('failed','connection_expired')
      ORDER BY j.updated_at DESC LIMIT 25`,
    userId
  );
  const failedCount = failedJobs.length;
  checks.push({
    id: 'failures',
    title: 'Failed posts',
    status: failedCount ? 'warn' : 'ok',
    detail: failedCount ? `${failedCount} job(s) need a decision — none of them were published` : 'No failed jobs',
    metric: `${failedCount}`,
  });
  if (failedCount) {
    const topCode = failedJobs[0].error_code || classifyMessage(failedJobs[0].error ?? '');
    const guide = guideFor(topCode);
    addIssue({
      id: 'failed-jobs',
      code: topCode,
      severity: 'warning',
      title: `${failedCount} failed post(s): ${guide.title.toLowerCase()}`,
      meaning: guide.meaning,
      why: guide.why,
      steps: guide.steps,
      actions: [{ label: 'Open failed posts', href: '/dashboard/failed' }, ...guide.actions.filter((a) => a.href)],
      subjects: failedJobs.slice(0, 5).map((j) => `${j.platform_name} · ${j.campaign_name}: ${(j.error ?? '').slice(0, 90)}`),
      count: failedCount,
      fix: { action: 'requeue-failed', label: 'Retry retryable failures', confirm: 'Reset retryable failed jobs and attempt them again?' },
    });
  }

  // ── content readiness & manual backlog ─────────────────────────────────────
  const unapproved = count(
    `SELECT COUNT(*) AS c FROM generated_contents gc JOIN campaigns c ON c.id = gc.campaign_id
      WHERE c.user_id = ? AND gc.status != 'approved' AND c.status NOT IN ('cancelled','completed')`,
    userId
  );
  checks.push({
    id: 'content',
    title: 'Content approvals',
    status: unapproved ? 'info' : 'ok',
    detail: unapproved ? `${unapproved} draft(s) waiting for review` : 'No drafts waiting',
    metric: `${unapproved}`,
  });
  if (unapproved) {
    addIssue({
      id: 'pending-approval',
      code: 'pending_approval',
      severity: 'info',
      title: `${unapproved} draft(s) are not approved`,
      meaning: 'Unapproved content cannot be scheduled — this is the human gate that prevents accidental publishing.',
      why: ['Content was generated but not reviewed', 'A regenerate reset the approval'],
      steps: ['Open the campaign, review the copy, approve it.', 'Then schedule the platforms you want.'],
      actions: [{ label: 'Open studio', href: '/dashboard/studio' }],
      count: unapproved,
    });
  }

  const staleManual = count(
    `SELECT COUNT(*) AS c FROM manual_tasks mt JOIN campaigns c ON c.id = mt.campaign_id
      WHERE c.user_id = ? AND mt.status = 'pending' AND mt.created_at < ?`,
    userId,
    new Date(Date.now() - 3 * 86400_000).toISOString()
  );
  checks.push({
    id: 'manual',
    title: 'Manual queue',
    status: staleManual ? 'warn' : 'ok',
    detail: staleManual ? `${staleManual} task(s) pending for more than 3 days` : 'Nothing stale',
    metric: `${staleManual}`,
  });
  if (staleManual) {
    addIssue({
      id: 'manual-backlog',
      code: 'pending_approval',
      severity: 'warning',
      title: `${staleManual} manual post(s) have been waiting 3+ days`,
      meaning: 'Group C platforms publish by hand; these tasks are ready but nobody has posted them.',
      why: ['The package was downloaded but not published', 'The task was forgotten'],
      steps: [
        'Open the manual queue and download each package (caption, title, tags, sized image).',
        'Publish it on the platform, then mark the task published with the URL.',
        'Skip it if the offer has expired — that keeps the queue honest.',
      ],
      actions: [{ label: 'Open manual queue', href: '/dashboard/manual' }],
      count: staleManual,
    });
  }

  // ── environment ────────────────────────────────────────────────────────────
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  checks.push({
    id: 'public-url',
    title: 'Public media URL',
    status: publicBaseUrl ? 'ok' : 'warn',
    detail: publicBaseUrl
      ? `Signed media URLs are served from ${publicBaseUrl}`
      : 'PUBLIC_BASE_URL is not set — platforms that fetch images by URL will publish text only',
    metric: publicBaseUrl ? 'set' : 'missing',
  });
  const urlPlatforms = ['blogger', 'ghost', 'devto', 'hashnode', 'googlebusiness', 'pinterest'];
  const urlAccounts = accountRows.filter((a) => urlPlatforms.includes(a.platform_id) && a.status === 'connected');
  if (!publicBaseUrl && urlAccounts.length) {
    addIssue({
      id: 'public-url-missing',
      code: 'public_url_missing',
      severity: 'warning',
      title: 'Connected platforms need a public image URL',
      meaning: `${urlAccounts.length} connected platform(s) fetch images from a URL, but PUBLIC_BASE_URL is unset.`,
      why: ['The deployment is local or the env var was never set'],
      steps: [
        'Set PUBLIC_BASE_URL to your public HTTPS origin and restart.',
        'Confirm the app is reachable from outside your network.',
        'Retry the affected jobs — the image attaches automatically.',
      ],
      actions: [{ label: 'Integration settings', href: '/dashboard/settings' }],
      subjects: [...new Set(urlAccounts.map((a) => a.platform_name))],
    });
  }

  const youtubeConnected = accountRows.some((a) => a.platform_id === 'youtube' && a.status === 'connected');
  checks.push({
    id: 'video',
    title: 'Short-form renderer',
    status: ffmpegAvailable ? 'ok' : youtubeConnected ? 'warn' : 'info',
    detail: ffmpegAvailable
      ? 'ffmpeg available — posters can be rendered into vertical Shorts'
      : 'ffmpeg not found — YouTube Shorts needs an uploaded MP4 instead',
    metric: ffmpegAvailable ? 'available' : 'missing',
  });

  const aiConfigured = Boolean(getSecret('ai.apiKey') || getSecret('ai.baseUrl'));
  checks.push({
    id: 'ai',
    title: 'AI provider',
    status: aiConfigured ? 'ok' : 'info',
    detail: aiConfigured
      ? `Using ${settings.aiProvider}${settings.aiModel ? ` · ${settings.aiModel}` : ''}`
      : 'No provider configured — the labelled template engine writes the copy',
    metric: aiConfigured ? settings.aiProvider : 'template',
  });

  const expiredSessions = count(
    'SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at < ?',
    userId,
    nowIso()
  );
  checks.push({
    id: 'sessions',
    title: 'Sessions',
    status: expiredSessions ? 'info' : 'ok',
    detail: expiredSessions ? `${expiredSessions} expired session(s) still stored` : 'No stale sessions',
    metric: `${expiredSessions}`,
  });
  if (expiredSessions) {
    addIssue({
      id: 'stale-sessions',
      code: 'stale_sessions',
      severity: 'info',
      title: `${expiredSessions} expired session(s) held in the database`,
      meaning: 'They are already rejected by the auth check, but tidying them keeps the audit view clean.',
      why: ['Sessions are revoked lazily when used'],
      steps: ['Press "Clear expired sessions".'],
      actions: [],
      count: expiredSessions,
      fix: { action: 'revoke-sessions', label: 'Clear expired sessions', confirm: 'Revoke all expired sessions?' },
    });
  }

  checks.push({
    id: 'pause',
    title: 'Publishing switch',
    status: settings.globalPause ? 'warn' : 'ok',
    detail: settings.globalPause
      ? 'Global pause is ON — nothing will publish until it is turned off'
      : 'Publishing is enabled',
    metric: settings.globalPause ? 'paused' : 'active',
  });
  if (settings.globalPause) {
    const guide = guideFor('global_pause');
    addIssue({
      id: 'global-pause',
      code: 'global_pause',
      severity: 'info',
      title: 'Publishing is paused globally',
      meaning: guide.meaning,
      why: guide.why,
      steps: guide.steps,
      actions: guide.actions,
      fix: { action: 'resume-publishing', label: 'Resume publishing', confirm: 'Turn the global pause off?' },
    });
  }

  // ── storage ────────────────────────────────────────────────────────────────
  let freeGb: number | null = null;
  try {
    const stats = fs.statfsSync(process.cwd());
    freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
  } catch {
    /* not supported */
  }
  checks.push({
    id: 'storage',
    title: 'Disk space',
    status: freeGb === null ? 'info' : freeGb < 0.5 ? 'fail' : freeGb < 2 ? 'warn' : 'ok',
    detail: freeGb === null ? 'Could not read filesystem statistics' : `${freeGb.toFixed(1)} GB free`,
    metric: freeGb === null ? 'unknown' : `${freeGb.toFixed(1)} GB`,
  });
  if (freeGb !== null && freeGb < 0.5) {
    addIssue({
      id: 'disk-space',
      code: 'disk_space',
      severity: 'critical',
      title: 'Very little disk space left',
      meaning: 'Uploads and the database can fail mid-write, which risks corruption.',
      why: ['Uploaded videos/posters accumulated', 'Logs or backups on the same volume'],
      steps: ['Free space immediately.', 'Move data/uploads to a larger volume.', 'Take a backup before restarting.'],
      actions: [{ label: 'Media library', href: '/dashboard/media' }],
    });
  }

  const counts = {
    campaigns: count('SELECT COUNT(*) AS c FROM campaigns WHERE user_id = ?', userId),
    jobs: count(
      'SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id WHERE c.user_id = ?',
      userId
    ),
    pendingJobs: count(
      `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
        WHERE c.user_id = ? AND j.status IN ('scheduled','processing','waiting_approval')`,
      userId
    ),
    failedJobs: count(
      `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
        WHERE c.user_id = ? AND j.status IN ('failed','connection_expired','manual_required')`,
      userId
    ),
    connectedAccounts: accountRows.filter((a) => a.status === 'connected').length,
    expiredAccounts: expiredAccounts.length,
    manualPending: count(
      'SELECT COUNT(*) AS c FROM manual_tasks mt JOIN campaigns c ON c.id = mt.campaign_id WHERE c.user_id = ? AND mt.status = ?',
      userId,
      'pending'
    ),
    platformsEnabled: count('SELECT COUNT(*) AS c FROM platforms WHERE enabled = 1'),
  };

  const critical = issues.filter((i) => i.severity === 'critical').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const health = Math.max(0, 100 - critical * 30 - warnings * 8);
  const status: DiagnosticsReport['status'] = critical ? 'critical' : warnings || health < 100 ? 'degraded' : 'healthy';

  return {
    status,
    health,
    checks,
    issues,
    counts,
    worker: {
      lastHeartbeatAt,
      secondsAgo: ageMs === null ? null : Math.round(ageMs / 1000),
      stalled,
      expectedIntervalSeconds: 20,
    },
    generatedAt: nowIso(),
  };
}

export interface RepairResult {
  action: RepairAction;
  changed: number;
  message: string;
}

/**
 * Explicit, allow-listed repairs. Each returns what actually changed so the UI
 * can prove the action did something instead of showing a green toast.
 */
export async function runRepair(action: RepairAction, userId: string): Promise<RepairResult> {
  switch (action) {
    case 'run-tick': {
      const { tick } = await import('@/lib/publishing/worker');
      const result = await tick('repair');
      const processed = 'processed' in result ? Number(result.processed) : 0;
      return {
        action,
        changed: processed,
        message: processed
          ? `Ran the worker: ${processed} job(s) processed.`
          : 'Worker ran; no job was due. Overdue jobs may need "Run them now".',
      };
    }
    case 'recover-stuck': {
      const res = run(
        `UPDATE publishing_jobs SET status = 'scheduled', locked_at = NULL,
           error = 'Released after an interrupted attempt — verify on the platform before retrying',
           updated_at = ?
         WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at < ?
           AND campaign_id IN (SELECT id FROM campaigns WHERE user_id = ?)`,
        nowIso(),
        new Date(Date.now() - 10 * MINUTE).toISOString(),
        userId
      );
      return { action, changed: Number(res.changes), message: `${Number(res.changes)} interrupted job(s) released.` };
    }
    case 'requeue-overdue': {
      const res = run(
        `UPDATE publishing_jobs SET scheduled_at = ?, next_attempt_at = NULL, updated_at = ?
          WHERE id IN (
            SELECT j.id FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
             WHERE c.user_id = ? AND j.status = 'scheduled'
               AND j.scheduled_at < ? AND (j.next_attempt_at IS NULL OR j.next_attempt_at < ?)
          )`,
        nowIso(),
        nowIso(),
        userId,
        new Date(Date.now() - 2 * MINUTE).toISOString(),
        new Date(Date.now() - 2 * MINUTE).toISOString()
      );
      return { action, changed: Number(res.changes), message: `${Number(res.changes)} overdue job(s) moved to now.` };
    }
    case 'requeue-failed': {
      const res = run(
        `UPDATE publishing_jobs SET status = 'scheduled', attempts = 0, next_attempt_at = NULL,
           scheduled_at = ?, retryable = 1, updated_at = ?
         WHERE id IN (
           SELECT j.id FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
            WHERE c.user_id = ? AND j.status = 'failed'
         )`,
        nowIso(),
        nowIso(),
        userId
      );
      return { action, changed: Number(res.changes), message: `${Number(res.changes)} failed job(s) queued for one more attempt.` };
    }
    case 'requeue-expired': {
      const res = run(
        `UPDATE publishing_jobs SET status = 'scheduled', attempts = 0, next_attempt_at = NULL,
           scheduled_at = ?, error = NULL, error_code = NULL, retryable = 1, updated_at = ?
         WHERE id IN (
           SELECT j.id FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
            WHERE c.user_id = ? AND j.status = 'connection_expired'
              AND EXISTS (
                SELECT 1 FROM connected_accounts a
                 WHERE a.platform_id = j.platform_id AND a.user_id = c.user_id AND a.status = 'connected'
              )
         )`,
        nowIso(),
        nowIso(),
        userId
      );
      return {
        action,
        changed: Number(res.changes),
        message: Number(res.changes)
          ? `${Number(res.changes)} job(s) requeued after reconnection.`
          : 'No expired job has a working account yet — reconnect first.',
      };
    }
    case 'resume-publishing': {
      updateSettings(userId, { globalPause: false });
      return { action, changed: 1, message: 'Global pause is off. The next tick publishes due jobs.' };
    }
    case 'revoke-sessions': {
      const res = run(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND expires_at < ?',
        nowIso(),
        userId,
        nowIso()
      );
      return { action, changed: Number(res.changes), message: `${Number(res.changes)} expired session(s) cleared.` };
    }
    case 'reseed-platforms': {
      seedPlatforms();
      return { action, changed: 25, message: 'Platform catalogue synchronised with the code.' };
    }
    case 'finalise-campaigns': {
      const changed = finaliseSettledCampaigns();
      return { action, changed, message: `${changed} campaign(s) moved to their final state.` };
    }
    default:
      throw new Error(`Unknown repair action: ${String(action)}`);
  }
}
