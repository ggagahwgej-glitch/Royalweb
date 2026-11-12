import { handler, jsonOk, ApiError, audit } from '@/lib/api';
import { get, nowIso, run } from '@/lib/db';
import { getAdapter } from '@/lib/platforms';
import { getSettings } from '@/lib/settings';
import { analyzePoster, generateContent } from '@/lib/ai';
import { contentOut } from '@/lib/serialize';
import { absoluteMediaPath } from '@/lib/media/storage';
import { contentFingerprint } from '@/lib/content-hash';
import { all } from '@/lib/db';
import fs from 'node:fs';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const POST = handler(async (_req, ctx, auth) => {
  const { id } = await ctx.params;
  enforceRateLimit(`regen:${auth.user.id}`, 40, 600);
  const content = get<{ id: string; campaign_id: string; platform_id: string }>(
    `SELECT gc.id, gc.campaign_id, gc.platform_id FROM generated_contents gc
       JOIN campaigns c ON c.id = gc.campaign_id WHERE gc.id = ? AND c.user_id = ?`,
    id,
    auth.user.id
  );
  if (!content) throw new ApiError(404, 'Content not found', 'not_found');
  const adapter = getAdapter(content.platform_id);
  if (!adapter) throw new ApiError(400, 'Unknown platform', 'unknown_platform');

  const campaign = get<Record<string, unknown>>('SELECT * FROM campaigns WHERE id = ?', content.campaign_id)!;
  const media = all<{ filename: string }>(
    "SELECT filename FROM media_assets WHERE campaign_id = ? AND kind = 'image' AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
    content.campaign_id
  );
  const settings = getSettings(auth.user.id);
  const posterBuffer = media.length ? fs.readFileSync(absoluteMediaPath(media[0].filename)) : undefined;
  const analysis = posterBuffer
    ? await analyzePoster(posterBuffer, settings, { campaignId: content.campaign_id })
    : undefined;

  if (!analysis) throw new ApiError(400, 'Upload a poster before regenerating content.', 'no_media');

  const outcome = await generateContent({
    campaign: {
      id: campaign.id as string,
      name: String(campaign.name),
      businessCategory: String(campaign.business_category),
      serviceName: String(campaign.service_name),
      offerPrice: String(campaign.offer_price),
      websiteUrl: String(campaign.website_url),
      whatsappUrl: String(campaign.whatsapp_url),
      contactInfo: String(campaign.contact_info),
      description: String(campaign.description),
      targetAudience: String(campaign.target_audience),
      language: String(campaign.language),
      cta: String(campaign.cta),
    },
    settings,
    analysis,
    adapters: [adapter],
    posterBuffer,
    userId: auth.user.id,
  });
  const generated = outcome.contents[0];
  if (!generated) throw new ApiError(500, 'Generation returned no content', 'generation_failed');

  const hash = contentFingerprint({
    platform: generated.platform,
    title: generated.title,
    caption: generated.caption,
    description: generated.description,
    hashtags: generated.hashtags,
  });
  run(
    `UPDATE generated_contents SET title = ?, caption = ?, description = ?, hashtags_json = ?, cta = ?,
       destination_url = ?, alt_text = ?, extra_json = ?, status = 'draft', content_hash = ?, generator = ?, model = ?,
       version = version + 1, updated_at = ? WHERE id = ?`,
    generated.title,
    generated.caption,
    generated.description,
    JSON.stringify(generated.hashtags),
    generated.cta,
    String(campaign.website_url ?? ''),
    generated.altText,
    JSON.stringify(generated.extra),
    hash,
    outcome.mode === 'template' ? 'template' : 'ai',
    outcome.model,
    nowIso(),
    id
  );
  await audit('content.regenerated', 'generated_content', id, auth.user.id, { platform: content.platform_id });

  const updated = get<Record<string, unknown>>(
    `SELECT gc.*, p.name AS platform_name, p.automation FROM generated_contents gc
       JOIN platforms p ON p.id = gc.platform_id WHERE gc.id = ?`,
    id
  );
  return jsonOk({ content: contentOut(updated!), notices: outcome.notices, mode: outcome.mode });
});
