import { handler, jsonOk, ApiError, parseBody, audit } from '@/lib/api';
import { all, get, newId, nowIso, run, tx } from '@/lib/db';
import { getAdapter } from '@/lib/platforms';
import { scheduleSchema } from '@/lib/validation';
import { jobOut, manualOut } from '@/lib/serialize';
import { processDueJobs } from '@/lib/publishing/engine';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export const POST = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  enforceRateLimit(`schedule:${auth.user.id}`, 40, 300);
  const body = await parseBody(req, scheduleSchema);

  const campaign = get<Record<string, unknown>>('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', id, auth.user.id);
  if (!campaign) throw new ApiError(404, 'Campaign not found', 'not_found');
  if (campaign.status === 'cancelled') throw new ApiError(400, 'This campaign was cancelled.', 'campaign_cancelled');

  const contents = all<{
    id: string;
    platform_id: string;
    status: string;
  }>('SELECT id, platform_id, status FROM generated_contents WHERE campaign_id = ?', id);
  if (!contents.length) throw new ApiError(400, 'Generate content before scheduling.', 'no_content');

  const selected = [...new Set(body.platforms)];
  const missingContent = selected.filter((pid) => !contents.some((c) => c.platform_id === pid));
  if (missingContent.length) {
    throw new ApiError(
      400,
      `No generated content for: ${missingContent.join(', ')}. Generate content for these platforms first.`,
      'missing_content'
    );
  }
  if (body.requireApproved) {
    const unapproved = selected.filter((pid) => contents.find((c) => c.platform_id === pid)?.status !== 'approved');
    if (unapproved.length) {
      throw new ApiError(
        400,
        `Approve the content for these platforms before scheduling: ${unapproved.join(', ')}.`,
        'content_not_approved',
        { platforms: unapproved }
      );
    }
  }

  const baseTime = body.publishNow
    ? nowIso()
    : body.scheduledAt
      ? new Date(body.scheduledAt).toISOString()
      : nowIso();
  if (Number.isNaN(new Date(baseTime).getTime())) throw new ApiError(400, 'Invalid scheduled time', 'bad_time');

  const scheduleResults: { platformId: string; kind: 'job' | 'manual'; status: string; message?: string }[] = [];

  tx(() => {
    for (const platformId of selected) {
      const adapter = getAdapter(platformId);
      const content = contents.find((c) => c.platform_id === platformId)!;
      if (!adapter) continue;

      if (adapter.automation === 'manual') {
        run(
          `INSERT INTO manual_tasks (id, campaign_id, platform_id, content_id, status, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', '', ?, ?)
           ON CONFLICT(campaign_id, platform_id) DO UPDATE SET content_id = excluded.content_id,
             status = CASE WHEN manual_tasks.status = 'published' THEN 'published' ELSE 'pending' END,
             updated_at = excluded.updated_at`,
          newId(),
          id,
          platformId,
          content.id,
          nowIso(),
          nowIso()
        );
        run(
          'UPDATE platforms SET last_activity_at = ?, credential_status = ? WHERE id = ?',
          nowIso(),
          'manual',
          platformId
        );
        scheduleResults.push({ platformId, kind: 'manual', status: 'pending' });
        continue;
      }

      const account = get<{ id: string; status: string }>(
        `SELECT id, status FROM connected_accounts WHERE platform_id = ? AND user_id = ? AND status = 'connected'
          ORDER BY created_at LIMIT 1`,
        platformId,
        auth.user.id
      );

      const scheduledAt = body.perPlatformTimes?.[platformId]
        ? new Date(body.perPlatformTimes[platformId]).toISOString()
        : baseTime;
      const idempotencyKey = `${id}:${platformId}:${scheduledAt}`;

      const existingJob = get<{ id: string; status: string }>(
        'SELECT id, status FROM publishing_jobs WHERE campaign_id = ? AND platform_id = ? AND status IN (\'scheduled\',\'processing\',\'published\')',
        id,
        platformId
      );
      if (existingJob) {
        scheduleResults.push({
          platformId,
          kind: 'job',
          status: existingJob.status,
          message: 'A job already exists for this platform and campaign.',
        });
        continue;
      }

      const status = account ? 'scheduled' : 'manual_required';
      const error = account
        ? null
        : `No ${adapter.name} account is connected. Connect one to publish automatically, or use the manual package.`;

      // The idempotency key is unique, so a previously cancelled/failed job for
      // the same slot used to swallow the insert silently while the UI still
      // reported "scheduled". Reuse that row instead and report the real state.
      const sameSlot = get<{ id: string; status: string }>(
        'SELECT id, status FROM publishing_jobs WHERE idempotency_key = ?',
        idempotencyKey
      );
      if (sameSlot) {
        if (['cancelled', 'failed', 'connection_expired', 'manual_required'].includes(sameSlot.status)) {
          run(
            `UPDATE publishing_jobs SET status = ?, account_id = ?, content_id = ?, scheduled_at = ?,
               attempts = 0, next_attempt_at = NULL, error = ?, error_code = ?, retryable = ?, updated_at = ?
             WHERE id = ?`,
            status,
            account?.id ?? null,
            content.id,
            scheduledAt,
            error,
            account ? null : 'no_account',
            account ? 1 : 0,
            nowIso(),
            sameSlot.id
          );
          scheduleResults.push({
            platformId,
            kind: 'job',
            status,
            message: error ?? `Reused the ${sameSlot.status.replace(/_/g, ' ')} job for this slot.`,
          });
        } else {
          scheduleResults.push({
            platformId,
            kind: 'job',
            status: sameSlot.status,
            message: `A ${sameSlot.status.replace(/_/g, ' ')} job already exists for this exact slot.`,
          });
        }
        continue;
      }

      run(
        `INSERT INTO publishing_jobs (id, campaign_id, platform_id, account_id, media_id, content_id, scheduled_at,
           status, attempts, max_attempts, idempotency_key, error, error_code, retryable, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 0, 3, ?, ?, ?, ?, ?, ?)`,
        newId(),
        id,
        platformId,
        account?.id ?? null,
        content.id,
        scheduledAt,
        status,
        idempotencyKey,
        error,
        account ? null : 'no_account',
        account ? 1 : 0,
        nowIso(),
        nowIso()
      );
      scheduleResults.push({ platformId, kind: 'job', status, message: error ?? undefined });
    }

    const interval = body.recurrence === 'daily' ? 24 : body.recurrence === 'weekly' ? 168 : null;
    run(
      `UPDATE campaigns SET status = 'scheduled', scheduled_at = ?, timezone = ?, recurrence = ?,
         next_recurrence_at = ?, updated_at = ? WHERE id = ?`,
      baseTime,
      body.timezone,
      body.recurrence,
      interval ? new Date(new Date(baseTime).getTime() + interval * 3600_000).toISOString() : null,
      nowIso(),
      id
    );
  });

  const isNow = new Date(baseTime).getTime() <= Date.now() + 30_000;
  let publishOutcomes: Awaited<ReturnType<typeof processDueJobs>> | null = null;
  if (isNow) {
    publishOutcomes = await processDueJobs(5);
  }

  const jobs = all(
    `SELECT j.*, p.name AS platform_name, p.automation, a.account_name FROM publishing_jobs j
       JOIN platforms p ON p.id = j.platform_id
       LEFT JOIN connected_accounts a ON a.id = j.account_id
      WHERE j.campaign_id = ? ORDER BY j.scheduled_at`,
    id
  );
  const manualTasks = all(
    `SELECT mt.*, p.name AS platform_name FROM manual_tasks mt JOIN platforms p ON p.id = mt.platform_id
      WHERE mt.campaign_id = ? ORDER BY p.sort_order`,
    id
  );

  await audit('campaign.scheduled', 'campaign', id, auth.user.id, {
    platforms: selected.length,
    publishNow: body.publishNow,
    scheduledAt: baseTime,
  });

  return jsonOk({
    scheduled: scheduleResults,
    jobs: jobs.map(jobOut),
    manualTasks: manualTasks.map(manualOut),
    publishNow: isNow,
    outcomes: publishOutcomes?.outcomes ?? [],
  });
});
