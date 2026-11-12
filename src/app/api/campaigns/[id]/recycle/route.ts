import { z } from 'zod';
import { inWorkspace } from '@/lib/scope';
import { handler, jsonOk, parseBody, audit, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { dueForRecycling, recycleCampaign, setRecycleWindow } from '@/lib/evergreen';
import { get } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  windowDays: z.number().int().min(0).max(365).optional(),
  recycleNow: z.boolean().optional(),
});

export const GET = handler(async (_req, ctx, auth) => {
  const { id } = await ctx.params;
  const campaign = get<{ recycle_after_days: number; status: string; recycled_from: string | null }>(
    'SELECT recycle_after_days, status, recycled_from FROM campaigns WHERE id = ? AND user_id = ?',
    id,
    auth.user.id
  );
  if (!campaign || !inWorkspace('campaigns', id, auth)) throw new ApiError(404, 'Campaign not found', 'not_found');
  return jsonOk({
    windowDays: Number(campaign.recycle_after_days ?? 0),
    status: campaign.status,
    recycledFrom: campaign.recycled_from,
    due: dueForRecycling(50, auth.user.id).some((c) => c.id === id),
  });
});

export const POST = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  enforceRateLimit(`recycle:${auth.user.id}`, 20, 3600);
  const body = await parseBody(req, schema);

  if (body.windowDays !== undefined) {
    const applied = setRecycleWindow(id, auth.user.id, body.windowDays);
    if (applied === null) throw new ApiError(404, 'Campaign not found', 'not_found');
    await audit('campaign.recycle_window', 'campaign', id, auth.user.id, { days: applied });
    return jsonOk({ windowDays: applied });
  }

  if (!body.recycleNow) throw new ApiError(400, 'Pass recycleNow:true or windowDays', 'bad_request');
  try {
    const result = await recycleCampaign(id, auth.user.id);
    await audit('campaign.recycled', 'campaign', result.campaignId, auth.user.id, {
      source: id,
      contents: result.contents,
      mode: result.mode,
    });
    return jsonOk({ result });
  } catch (err) {
    throw new ApiError(400, (err as Error).message, 'recycle_failed');
  }
});
