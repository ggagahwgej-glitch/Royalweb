import { handler, jsonOk, ApiError, parseBody, audit } from '@/lib/api';
import { get, nowIso, run } from '@/lib/db';
import { publishJob } from '@/lib/publishing/engine';
import { jobOut } from '@/lib/serialize';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({ action: z.enum(['retry', 'publish', 'force', 'cancel']) });

export const POST = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const { action } = await parseBody(req, schema);
  const job = get<{ id: string; status: string; campaign_id: string }>(
    `SELECT j.id, j.status, j.campaign_id FROM publishing_jobs j
       JOIN campaigns c ON c.id = j.campaign_id WHERE j.id = ? AND c.user_id = ?`,
    id,
    auth.user.id
  );
  if (!job) throw new ApiError(404, 'Job not found', 'not_found');

  if (action === 'cancel') {
    if (job.status === 'published') throw new ApiError(400, 'Published jobs cannot be cancelled.', 'already_published');
    run(
      "UPDATE publishing_jobs SET status = 'cancelled', error = 'Cancelled by admin', retryable = 0, updated_at = ? WHERE id = ?",
      nowIso(),
      id
    );
    await audit('job.cancelled', 'publishing_job', id, auth.user.id);
  } else {
    if (job.status === 'processing') throw new ApiError(409, 'This job is already being published.', 'busy');
    run(
      `UPDATE publishing_jobs SET status = 'scheduled', attempts = 0, next_attempt_at = NULL,
         scheduled_at = ?, error = NULL, error_code = NULL, retryable = 1, updated_at = ? WHERE id = ?`,
      action === 'publish' ? nowIso() : new Date(Date.now() + 60_000).toISOString(),
      nowIso(),
      id
    );
    const outcome = await publishJob(id, { force: action === 'force', trigger: 'manual' });
    await audit(`job.${action}`, 'publishing_job', id, auth.user.id, { status: outcome.status });
    const row = get<Record<string, unknown>>(
      `SELECT j.*, c.name AS campaign_name, p.name AS platform_name, p.automation, a.account_name
         FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
         JOIN platforms p ON p.id = j.platform_id
         LEFT JOIN connected_accounts a ON a.id = j.account_id WHERE j.id = ?`,
      id
    );
    return jsonOk({ outcome, job: jobOut(row!) });
  }

  const row = get<Record<string, unknown>>(
    `SELECT j.*, c.name AS campaign_name, p.name AS platform_name, p.automation, a.account_name
       FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
       JOIN platforms p ON p.id = j.platform_id
       LEFT JOIN connected_accounts a ON a.id = j.account_id WHERE j.id = ?`,
    id
  );
  return jsonOk({ job: jobOut(row!) });
});
