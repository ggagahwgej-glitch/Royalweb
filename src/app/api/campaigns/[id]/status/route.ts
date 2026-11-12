import { inWorkspace } from '@/lib/scope';
import { handler, jsonOk, ApiError, parseBody, audit } from '@/lib/api';
import { get, nowIso, run } from '@/lib/db';
import { z } from 'zod';
import { processDueJobs } from '@/lib/publishing/engine';

export const dynamic = 'force-dynamic';

const schema = z.object({ action: z.enum(['pause', 'resume', 'cancel']) });

export const POST = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const { action } = await parseBody(req, schema);
  const campaign = get<{ id: string; status: string }>(
    'SELECT id, status FROM campaigns WHERE id = ? AND user_id = ?',
    id,
    auth.user.id
  );
  if (!campaign || !inWorkspace('campaigns', id, auth)) throw new ApiError(404, 'Campaign not found', 'not_found');

  if (action === 'pause') {
    run("UPDATE campaigns SET status = 'paused', updated_at = ? WHERE id = ?", nowIso(), id);
  } else if (action === 'resume') {
    run("UPDATE campaigns SET status = 'scheduled', updated_at = ? WHERE id = ?", nowIso(), id);
    await processDueJobs(3);
  } else {
    run("UPDATE campaigns SET status = 'cancelled', updated_at = ? WHERE id = ?", nowIso(), id);
    run(
      `UPDATE publishing_jobs SET status = 'cancelled', error = 'Campaign cancelled by admin', updated_at = ?
        WHERE campaign_id = ? AND status IN ('scheduled','waiting_approval','manual_required')`,
      nowIso(),
      id
    );
  }
  await audit(`campaign.${action}`, 'campaign', id, auth.user.id);
  return jsonOk({ campaignId: id, action, status: action === 'pause' ? 'paused' : action === 'resume' ? 'scheduled' : 'cancelled' });
});
