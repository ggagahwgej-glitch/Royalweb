import { inWorkspace } from '@/lib/scope';
import { handler, jsonOk, ApiError, audit } from '@/lib/api';
import { all, get, newId, nowIso, run, tx } from '@/lib/db';
import { getAdapter, ADAPTERS } from '@/lib/platforms';
import { getSettings } from '@/lib/settings';
import { generateForCampaign } from '@/lib/generate';
import { contentOut } from '@/lib/serialize';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const bodySchema = z.object({
  platforms: z.array(z.string().min(1)).max(25).optional(),
  includeManual: z.boolean().default(true),
});

export const POST = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  enforceRateLimit(`generate:${auth.user.id}`, 25, 600);

  const campaign = get<Record<string, unknown>>('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', id, auth.user.id);
  if (!campaign || !inWorkspace('campaigns', id, auth)) throw new ApiError(404, 'Campaign not found', 'not_found');
  if (!campaign) throw new ApiError(404, 'Campaign not found', 'not_found');

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.parse(body);

  const requested = parsed.platforms?.length
    ? parsed.platforms
    : ADAPTERS.filter((a) => (parsed.includeManual ? true : a.automation !== 'manual')).map((a) => a.id);
  const adapters = requested
    .map((pid) => getAdapter(pid))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  if (!adapters.length) throw new ApiError(400, 'No valid platforms selected', 'no_platforms');

  const settings = getSettings(auth.user.id, auth.workspaceId ?? undefined);
  const media = all<{ id: string }>(
    "SELECT id FROM media_assets WHERE campaign_id = ? AND deleted_at IS NULL AND kind = 'image' LIMIT 1",
    id
  );
  if (!media.length) {
    throw new ApiError(
      400,
      'Upload at least one poster (JPG, PNG or WEBP) before generating content.',
      'no_media'
    );
  }

  let outcome;
  try {
    outcome = await generateForCampaign({ userId: auth.user.id, campaignId: id, settings, adapters });
  } catch (err) {
    throw new ApiError(400, (err as Error).message, 'generation_failed');
  }
  const analysis = outcome.analysis;

  const contents = all(
    `SELECT gc.*, p.name AS platform_name, p.automation FROM generated_contents gc
       JOIN platforms p ON p.id = gc.platform_id WHERE gc.campaign_id = ? ORDER BY p.sort_order`,
    id
  );

  await audit('campaign.generated', 'campaign', id, auth.user.id, {
    mode: outcome.mode,
    platforms: adapters.length,
  });

  return jsonOk({
    contents: contents.map(contentOut),
    mode: outcome.mode,
    provider: outcome.provider,
    model: outcome.model,
    notices: outcome.notices,
    analysis,
  });
});
