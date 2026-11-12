import 'server-only';
import fs from 'node:fs';
import { all, get, run, newId, nowIso, json } from '@/lib/db';
import { decryptJson } from '@/lib/crypto';
import { getAdapter } from '@/lib/platforms';
import type { AdapterMedia, PublishResult } from '@/lib/platforms/types';
import { businessProfile, getSettings } from '@/lib/settings';
import { buildPlatformImage, presetFor } from '@/lib/media/process';
import {
  absoluteMediaPath,
  readDerivative,
  saveDerivative,
  signedMediaUrl,
} from '@/lib/media/storage';
import { renderShortFromImage, ffmpegPath } from '@/lib/media/video';


export type JobStatus =
  | 'draft'
  | 'waiting_approval'
  | 'scheduled'
  | 'processing'
  | 'published'
  | 'failed'
  | 'manual_required'
  | 'connection_expired'
  | 'cancelled';

export interface PublishOutcome {
  jobId: string;
  status: JobStatus;
  message: string;
  url?: string | null;
  externalId?: string | null;
  retryInMinutes?: number;
}

interface JobRow {
  id: string;
  campaign_id: string;
  platform_id: string;
  account_id: string | null;
  media_id: string | null;
  content_id: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  scheduled_at: string;
  idempotency_key: string;
  next_attempt_at: string | null;
}

interface CampaignRow {
  [key: string]: unknown;
  id: string;
  user_id: string;
  name: string;
  status: string;
  timezone: string;
  duplicate_window_hours?: number;
}

interface AccountRow {
  id: string;
  platform_id: string;
  account_name: string;
  credentials_cipher: string;
  status: string;
  meta_json: string;
  token_expires_at: string | null;
}

function log(
  job: { id: string; campaign_id: string; platform_id: string },
  level: 'info' | 'warn' | 'error',
  step: string,
  message: string,
  meta?: Record<string, unknown>
) {
  run(
    'INSERT INTO publishing_logs (id, job_id, campaign_id, platform_id, level, step, message, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId(),
    job.id,
    job.campaign_id,
    job.platform_id,
    level,
    step,
    message.slice(0, 2000),
    JSON.stringify(meta ?? {}),
    nowIso()
  );
}

function backoffMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(attempts, 1) * 2, 60);
}

/**
 * Claim a single job atomically. Returns false when another worker already
 * took it, which is what makes retries safe (no duplicate publishing).
 */
function claim(jobId: string, allowRetry = false): JobRow | null {
  const current = get<JobRow>('SELECT * FROM publishing_jobs WHERE id = ?', jobId);
  if (!current) return null;
  const claimable = ['scheduled', 'waiting_approval', 'manual_required', 'connection_expired', 'failed'];
  if (!claimable.includes(current.status)) return null;
  if (current.status === 'failed' && !allowRetry) return null;
  const res = run(
    `UPDATE publishing_jobs SET status = 'processing', locked_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status = ?`,
    nowIso(),
    nowIso(),
    jobId,
    current.status
  );
  if (Number(res.changes) !== 1) return null;
  return { ...current, status: 'processing', attempts: Number(current.attempts) + 1 };
}

export async function publishJob(
  jobId: string,
  opts: { force?: boolean; trigger?: string } = {}
): Promise<PublishOutcome> {
  const claimed = claim(jobId, opts.force);
  if (!claimed) {
    const existing = get<{ status: string; error: string | null }>(
      'SELECT status, error FROM publishing_jobs WHERE id = ?',
      jobId
    );
    if (!existing) return { jobId, status: 'failed', message: 'Job not found' };
    return {
      jobId,
      status: existing.status as JobStatus,
      message:
        existing.status === 'processing'
          ? 'Job is already being published.'
          : existing.error || `Job is ${existing.status.replace(/_/g, ' ')}; it was not claimed for publishing.`,
    };
  }

  const finish = (
    status: JobStatus,
    message: string,
    extra: Partial<{
      errorCode: string;
      url: string | null;
      externalId: string | null;
      retryable: boolean;
      nextAttemptAt: string | null;
      release: boolean;
    }> = {}
  ): PublishOutcome => {
    run(
      `UPDATE publishing_jobs SET status = ?, error = ?, error_code = ?, published_url = ?, external_id = ?,
         retryable = ?, next_attempt_at = ?, locked_at = NULL,
         scheduled_at = CASE WHEN ? THEN ? ELSE scheduled_at END, updated_at = ?
       WHERE id = ?`,
      status,
      message.slice(0, 2000),
      extra.errorCode ?? null,
      extra.url ?? null,
      extra.externalId ?? null,
      extra.retryable === false ? 0 : 1,
      extra.nextAttemptAt ?? null,
      extra.release ? 1 : 0,
      extra.release ? (extra.nextAttemptAt ?? nowIso()) : nowIso(),
      nowIso(),
      jobId
    );
    return {
      jobId,
      status,
      message,
      url: extra.url ?? null,
      externalId: extra.externalId ?? null,
    };
  };

  const campaign = get<CampaignRow>('SELECT * FROM campaigns WHERE id = ?', claimed.campaign_id);
  const platform = get<{ id: string; name: string; enabled: number; automation: string }>(
    'SELECT id, name, enabled, automation FROM platforms WHERE id = ?',
    claimed.platform_id
  );
  const adapter = getAdapter(claimed.platform_id);
  const userSettings = campaign ? getSettings(String(campaign.user_id)) : null;

  if (!campaign) {
    log(claimed, 'error', 'campaign', 'Campaign no longer exists');
    return finish('failed', 'The campaign for this job no longer exists.', { errorCode: 'campaign_missing', retryable: false });
  }
  if (!adapter || !platform) {
    return finish('failed', `Unknown platform "${claimed.platform_id}".`, { errorCode: 'unknown_platform', retryable: false });
  }
  if (!platform.enabled) {
    return finish('failed', `${platform.name} is disabled in platform settings.`, { errorCode: 'platform_disabled', retryable: false });
  }
  if (campaign.status === 'cancelled') {
    return finish('cancelled', 'The campaign was cancelled.', { errorCode: 'campaign_cancelled', retryable: false });
  }
  if (campaign.status === 'paused' || userSettings?.globalPause || userSettings?.autoPublishEnabled === false) {
    log(claimed, 'warn', 'preflight', 'Publishing is paused — job released back to the schedule');
    return finish('scheduled', 'Publishing is paused (global pause or campaign paused). The job stays scheduled.', {
      errorCode: 'paused',
      retryable: true,
      nextAttemptAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      release: true,
    });
  }

  const account = claimed.account_id
    ? get<AccountRow>('SELECT * FROM connected_accounts WHERE id = ?', claimed.account_id)
    : get<AccountRow>(
        `SELECT * FROM connected_accounts WHERE platform_id = ? AND user_id = ? AND status = 'connected' ORDER BY created_at LIMIT 1`,
        claimed.platform_id,
        String(campaign.user_id)
      );

  if (!account) {
    const message = `${platform.name} has no connected account. Connect one in Connected Accounts, or use the manual publishing package.`;
    log(claimed, 'warn', 'account', message);
    return finish('manual_required', message, { errorCode: 'no_account', retryable: false });
  }
  if (account.status !== 'connected') {
    log(claimed, 'error', 'account', `Account ${account.account_name} is ${account.status}`);
    return finish(
      'connection_expired',
      `The ${platform.name} connection (${account.account_name}) is ${account.status}. Reconnect it to continue publishing.`,
      { errorCode: 'connection_expired', retryable: false }
    );
  }

  const content = claimed.content_id
    ? get<{
        title: string;
        caption: string;
        description: string;
        hashtags_json: string;
        cta: string;
        destination_url: string;
        alt_text: string;
        extra_json: string;
        status: string;
      }>('SELECT * FROM generated_contents WHERE id = ?', claimed.content_id)
    : undefined;
  if (!content) {
    return finish('failed', 'No generated content is attached to this job.', { errorCode: 'missing_content', retryable: false });
  }

  let credentials: Record<string, string> = {};
  let accountMeta: Record<string, unknown> = {};
  try {
    credentials = decryptJson<Record<string, string>>(account.credentials_cipher);
    accountMeta = json<Record<string, unknown>>(account.meta_json, {});
  } catch {
    run('UPDATE connected_accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?', 'error', 'Stored credentials could not be decrypted (encryption key changed?). Reconnect the account.', nowIso(), account.id);
    return finish('connection_expired', 'Stored credentials could not be decrypted. Reconnect the account.', {
      errorCode: 'credential_decrypt_failed',
      retryable: false,
    });
  }

  // ---------------------------------------------------------- duplicate guard
  const contentHashRow = get<{ content_hash: string }>(
    'SELECT content_hash FROM generated_contents WHERE id = ?',
    claimed.content_id
  );
  const duplicateWindow = Number(campaign.duplicate_window_hours ?? userSettings?.duplicateWindowHours ?? 72);
  if (!opts.force && contentHashRow?.content_hash) {
    const duplicate = get<{ id: string; published_at: string }>(
      `SELECT pp.id, pp.published_at
         FROM published_posts pp
         JOIN publishing_jobs pj ON pj.id = pp.job_id
         JOIN generated_contents gc ON gc.id = pj.content_id
        WHERE gc.content_hash = ? AND pp.platform_id = ? AND pp.published_at > ?
        LIMIT 1`,
      contentHashRow.content_hash,
      claimed.platform_id,
      new Date(Date.now() - duplicateWindow * 3600_000).toISOString()
    );
    if (duplicate) {
      const message = `Duplicate content already published on ${platform.name} at ${duplicate.published_at} (within the ${duplicateWindow}h duplicate window). Skipped to avoid spam. Use "Publish anyway" if this is intentional.`;
      log(claimed, 'warn', 'duplicate', message, { duplicateOf: duplicate.id });
      return finish('cancelled', message, { errorCode: 'duplicate_prevented', retryable: false });
    }
  }

  // ---------------------------------------------------------------- media prep
  const mediaRows = all<{
    id: string;
    filename: string;
    mime: string;
    kind: string;
    width: number | null;
    height: number | null;
    bytes: number;
    alt_text: string;
    deleted_at: string | null;
  }>(
    'SELECT id, filename, mime, kind, width, height, bytes, alt_text, deleted_at FROM media_assets WHERE campaign_id = ? AND deleted_at IS NULL ORDER BY created_at',
    claimed.campaign_id
  );

  const adapterMedia: AdapterMedia[] = [];
  const preset = presetFor(adapter.id);
  let preparedImage: AdapterMedia | null = null;

  for (const row of mediaRows) {
    if (row.kind !== 'image') continue;
    try {
      let derivative = readDerivative(row.id, adapter.id);
      if (!derivative) {
        const original = fs.readFileSync(absoluteMediaPath(row.filename));
        const built = await buildPlatformImage(original, adapter.id);
        saveDerivative(row.id, adapter.id, built.buffer);
        derivative = built.buffer;
        run(
          `INSERT INTO media_derivatives (id, media_id, platform_id, preset, filename, width, height, bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(media_id, preset) DO UPDATE SET bytes = excluded.bytes`,
          newId(),
          row.id,
          adapter.id,
          adapter.id,
          `derived/${row.id}/${adapter.id}.jpg`,
          built.width,
          built.height,
          built.buffer.length,
          nowIso()
        );
        log(claimed, 'info', 'media', `Generated ${preset.note} derivative (${built.width}×${built.height})`);
      }
      const item: AdapterMedia = {
        id: row.id,
        filename: `${adapter.id}-${row.id.slice(0, 8)}.jpg`,
        mime: 'image/jpeg',
        kind: 'image',
        width: preset.width,
        height: preset.height,
        buffer: derivative,
        altText: content.alt_text || row.alt_text,
        publicUrl: signedMediaUrl(row.id, adapter.id),
      };
      adapterMedia.push(item);
      preparedImage = preparedImage ?? item;
    } catch (err) {
      log(claimed, 'error', 'media', `Image preparation failed: ${(err as Error).message}`);
    }
  }

  // Video handling (YouTube Shorts): use an uploaded video, or render one.
  if (adapter.capabilities.video) {
    const videoRow = mediaRows.find((r) => r.kind === 'video');
    if (videoRow) {
      adapterMedia.push({
        id: videoRow.id,
        filename: `${adapter.id}-${videoRow.id.slice(0, 8)}.mp4`,
        mime: videoRow.mime || 'video/mp4',
        kind: 'video',
        width: videoRow.width,
        height: videoRow.height,
        buffer: fs.readFileSync(absoluteMediaPath(videoRow.filename)),
        altText: videoRow.alt_text,
        publicUrl: signedMediaUrl(videoRow.id, 'original'),
      });
      log(claimed, 'info', 'media', 'Using the uploaded video for this platform');
    } else if (mediaRows.some((r) => r.kind === 'image')) {
      const canRender = Boolean(await ffmpegPath());
      if (canRender) {
        const sourceRow = mediaRows.find((r) => r.kind === 'image')!;
        log(claimed, 'info', 'media', 'Rendering a vertical 12s Short from the poster');
        const rendered = await renderShortFromImage(fs.readFileSync(absoluteMediaPath(sourceRow.filename)));
        if (rendered.ok) {
          adapterMedia.push({
            id: `render_${claimed.id}`,
            filename: `${adapter.id}-short.mp4`,
            mime: 'video/mp4',
            kind: 'video',
            width: 1080,
            height: 1920,
            buffer: rendered.buffer,
            altText: content.alt_text,
          });
          log(claimed, 'info', 'media', `Rendered ${(rendered.buffer.length / 1024 / 1024).toFixed(1)} MB Short`);
        } else {
          log(claimed, 'warn', 'media', rendered.error);
        }
      } else {
        log(claimed, 'warn', 'media', 'No ffmpeg available — no video can be rendered for this campaign.');
      }
    }
  }

  const business = businessProfile(userSettings ?? getSettings(String(campaign.user_id)));
  const idempotencyKey = claimed.idempotency_key;

  log(claimed, 'info', 'publish', `Calling ${adapter.name} (${opts.trigger ?? 'worker'})`, {
    account: account.account_name,
    mediaCount: adapterMedia.length,
  });

  let result: PublishResult;
  try {
    result = await adapter.publish({
      account: { id: account.id, accountName: account.account_name, credentials, meta: accountMeta },
      content: {
        title: content.title,
        caption: content.caption,
        description: content.description,
        hashtags: json<string[]>(content.hashtags_json, []),
        cta: content.cta,
        destinationUrl: content.destination_url,
        altText: content.alt_text,
        extra: json<Record<string, unknown>>(content.extra_json, {}),
      },
      media: adapterMedia,
      campaign: { id: campaign.id, name: campaign.name, offerPrice: String(campaign.offer_price ?? '') },
      business,
      idempotencyKey,
      log: (step, message, meta) => log(claimed, 'info', step, message, meta),
    });
  } catch (err) {
    result = { ok: false, error: `Adapter crashed: ${(err as Error).message}`, errorCode: 'adapter_exception', retryable: true };
  }

  if (result.ok) {
    const publishedAt = nowIso();
    run(
      `UPDATE publishing_jobs SET status = 'published', published_url = ?, external_id = ?, error = NULL,
         error_code = NULL, retryable = 0, next_attempt_at = NULL, locked_at = NULL, updated_at = ? WHERE id = ?`,
      result.url ?? null,
      result.externalId ?? null,
      publishedAt,
      jobId
    );
    run(
      `INSERT INTO published_posts (id, job_id, campaign_id, platform_id, account_id, external_id, url, published_at, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET url = excluded.url, external_id = excluded.external_id, published_at = excluded.published_at`,
      newId(),
      jobId,
      claimed.campaign_id,
      claimed.platform_id,
      account.id,
      result.externalId ?? null,
      result.url ?? null,
      publishedAt,
      1
    );
    run(
      'UPDATE platforms SET last_activity_at = ?, last_error = NULL, last_error_at = NULL, credential_status = ? WHERE id = ?',
      publishedAt,
      'connected',
      claimed.platform_id
    );
    run('UPDATE connected_accounts SET last_error = NULL, updated_at = ? WHERE id = ?', publishedAt, account.id);
    log(claimed, 'info', 'publish', `Published successfully${result.url ? `: ${result.url}` : ''}`, {
      externalId: result.externalId,
    });
    finaliseCampaign(claimed.campaign_id);
    return {
      jobId,
      status: 'published',
      message: `Published to ${adapter.name}.`,
      url: result.url ?? null,
      externalId: result.externalId ?? null,
    };
  }

  const message = result.error || `Publishing to ${adapter.name} failed.`;
  const errorCode = result.errorCode || 'publish_failed';

  if (result.requiresManual) {
    run(
      `INSERT INTO manual_tasks (id, campaign_id, platform_id, content_id, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
       ON CONFLICT(campaign_id, platform_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at`,
      newId(),
      claimed.campaign_id,
      claimed.platform_id,
      claimed.content_id,
      message,
      nowIso(),
      nowIso()
    );
    log(claimed, 'warn', 'publish', `Manual action required: ${message}`);
    return finish('manual_required', message, { errorCode, retryable: false });
  }

  const authError = ['auth_expired', 'credential_decrypt_failed'].includes(errorCode);
  if (authError) {
    run(
      'UPDATE connected_accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?',
      'expired',
      message.slice(0, 800),
      nowIso(),
      account.id
    );
    run('UPDATE platforms SET last_error = ?, last_error_at = ?, credential_status = ? WHERE id = ?', message.slice(0, 800), nowIso(), 'expired', claimed.platform_id);
  }

  const canRetry = result.retryable !== false && claimed.attempts < claimed.max_attempts && !authError;
  if (canRetry) {
    const wait = backoffMinutes(claimed.attempts);
    const next = new Date(Date.now() + wait * 60_000).toISOString();
    log(claimed, 'warn', 'publish', `Temporary failure — retry #${claimed.attempts} in ${wait} minutes: ${message}`);
    const out = finish('scheduled', message, {
      errorCode,
      retryable: true,
      nextAttemptAt: next,
      release: true,
    });
    return { ...out, message: `${message} (retrying in ${wait} min)`, retryInMinutes: wait };
  }

  log(claimed, 'error', 'publish', `Permanent failure: ${message}`);
  const failed = finish(authError ? 'connection_expired' : 'failed', message, {
    errorCode,
    retryable: false,
  });
  // Do not leave the campaign stuck in "publishing" when nothing else is left
  // to run — the dashboard would otherwise show progress that will never move.
  finaliseCampaign(claimed.campaign_id);
  return failed;
}

function finaliseCampaign(campaignId: string) {
  const pending = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM publishing_jobs WHERE campaign_id = ? AND status IN ('scheduled','processing','waiting_approval','manual_required')`,
    campaignId
  );
  if (Number(pending?.c || 0) > 0) {
    run('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?', 'publishing', nowIso(), campaignId);
    return;
  }
  const published = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM publishing_jobs WHERE campaign_id = ? AND status = 'published'`,
    campaignId
  );
  const status = Number(published?.c || 0) > 0 ? 'completed' : 'failed';
  run('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), campaignId);
}

/** Process every job that is due, respecting retry timers and locks. */
export async function processDueJobs(limit = 3): Promise<{
  processed: number;
  recovered: number;
  outcomes: PublishOutcome[];
}> {
  // Recover jobs abandoned mid-flight (crash/restart) after 10 minutes.
  const recovered = run(
    `UPDATE publishing_jobs SET status = 'scheduled', locked_at = NULL,
       error = 'Recovered after an interrupted publish attempt', updated_at = ?
     WHERE status = 'processing' AND locked_at < ?`,
    nowIso(),
    new Date(Date.now() - 10 * 60_000).toISOString()
  );

  const due = all<{ id: string }>(
    `SELECT j.id FROM publishing_jobs j
       JOIN campaigns c ON c.id = j.campaign_id
      WHERE j.status = 'scheduled'
        AND j.scheduled_at <= ?
        AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?)
        AND c.status NOT IN ('cancelled','paused')
      ORDER BY j.scheduled_at ASC
      LIMIT ?`,
    nowIso(),
    nowIso(),
    limit
  );

  const outcomes: PublishOutcome[] = [];
  for (const row of due) {
    try {
      outcomes.push(await publishJob(row.id, { trigger: 'worker' }));
    } catch (err) {
      console.error('[engine] job failed unexpectedly', row.id, err);
    }
  }
  return { processed: outcomes.length, recovered: Number(recovered.changes || 0), outcomes };
}

export function campaignProgress(campaignId: string) {
  return all<{ status: string; c: number }>(
    'SELECT status, COUNT(*) AS c FROM publishing_jobs WHERE campaign_id = ? GROUP BY status',
    campaignId
  ).reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = Number(row.c);
    return acc;
  }, {});
}
