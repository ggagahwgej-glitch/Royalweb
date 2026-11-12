import { handler, jsonOk, parseBody, ApiError, audit } from '@/lib/api';
import { get, nowIso, run } from '@/lib/db';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ campaignId: z.string().uuid() });

export const POST = handler(async (req, _ctx, auth) => {
  const { campaignId } = await parseBody(req, schema);
  const campaign = get<{ id: string }>('SELECT id FROM campaigns WHERE id = ? AND user_id = ?', campaignId, auth.user.id);
  if (!campaign) throw new ApiError(404, 'Campaign not found', 'not_found');
  const res = run(
    "UPDATE generated_contents SET status = 'approved', updated_at = ? WHERE campaign_id = ?",
    nowIso(),
    campaignId
  );
  await audit('content.approved_all', 'campaign', campaignId, auth.user.id, { count: Number(res.changes) });
  return jsonOk({ approved: Number(res.changes) });
});
