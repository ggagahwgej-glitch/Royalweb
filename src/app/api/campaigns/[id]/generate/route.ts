import { handler, jsonOk, ApiError, audit } from '@/lib/api';
import { all, get, newId, nowIso, run, tx } from '@/lib/db';
import { getAdapter, ADAPTERS } from '@/lib/platforms';
import { getSettings } from '@/lib/settings';
import { analyzePoster, generateContent } from '@/lib/ai';
import { contentOut } from '@/lib/serialize';
import { absoluteMediaPath } from '@/lib/media/storage';
import { contentFingerprint } from '@/lib/content-hash';
import fs from 'node:fs';
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

  const settings = getSettings(auth.user.id);
  const media = all<{ id: string; filename: string; kind: string; original_name: string }>(
    "SELECT id, filename, kind, original_name FROM media_assets WHERE campaign_id = ? AND deleted_at IS NULL AND kind = 'image' ORDER BY created_at",
    id
  );
  if (!media.length) {
    throw new ApiError(
      400,
      'Upload at least one poster (JPG, PNG or WEBP) before generating content.',
      'no_media'
    );
  }

  const posterBuffer = fs.readFileSync(absoluteMediaPath(media[0].filename));
  const analysis = await analyzePoster(posterBuffer, settings, { campaignId: id });

  const campaignInput = {
    id,
    name: String(campaign.name ?? ''),
    businessCategory: String(campaign.business_category ?? ''),
    serviceName: String(campaign.service_name ?? ''),
    offerPrice: String(campaign.offer_price ?? ''),
    websiteUrl: String(campaign.website_url ?? ''),
    whatsappUrl: String(campaign.whatsapp_url ?? ''),
    contactInfo: String(campaign.contact_info ?? ''),
    description: String(campaign.description ?? ''),
    targetAudience: String(campaign.target_audience ?? ''),
    language: String(campaign.language ?? 'English'),
    cta: String(campaign.cta ?? ''),
  };

  const outcome = await generateContent({
    campaign: campaignInput,
    settings,
    analysis,
    adapters,
    posterBuffer,
    userId: auth.user.id,
  });

  const ts = nowIso();
  tx(() => {
    for (const content of outcome.contents) {
      const adapter = getAdapter(content.platform);
      if (!adapter) continue;
      const hash = contentFingerprint({
        platform: content.platform,
        title: content.title,
        caption: content.caption,
        description: content.description,
        hashtags: content.hashtags,
      });
      const existing = get<{ id: string; status: string }>(
        'SELECT id, status FROM generated_contents WHERE campaign_id = ? AND platform_id = ?',
        id,
        content.platform
      );
      if (existing) {
        run(
          `UPDATE generated_contents SET title = ?, caption = ?, description = ?, hashtags_json = ?, cta = ?,
             destination_url = ?, alt_text = ?, extra_json = ?, status = 'draft', content_hash = ?,
             generator = ?, model = ?, version = version + 1, updated_at = ?
           WHERE id = ?`,
          content.title,
          content.caption,
          content.description,
          JSON.stringify(content.hashtags),
          content.cta,
          campaignInput.websiteUrl,
          content.altText,
          JSON.stringify(content.extra),
          hash,
          outcome.mode === 'template' ? 'template' : 'ai',
          outcome.model,
          ts,
          existing.id
        );
      } else {
        run(
          `INSERT INTO generated_contents (id, campaign_id, platform_id, title, caption, description, hashtags_json,
             cta, destination_url, alt_text, extra_json, status, content_hash, generator, model, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 1, ?, ?)`,
          newId(),
          id,
          content.platform,
          content.title,
          content.caption,
          content.description,
          JSON.stringify(content.hashtags),
          content.cta,
          campaignInput.websiteUrl,
          content.altText,
          JSON.stringify(content.extra),
          hash,
          outcome.mode === 'template' ? 'template' : 'ai',
          outcome.model,
          ts,
          ts
        );
      }
    }
    run(
      `UPDATE campaigns SET analysis_json = ?, ai_provider = ?, ai_model = ?, status = CASE WHEN status = 'draft' THEN 'ready' ELSE status END,
         updated_at = ? WHERE id = ?`,
      JSON.stringify(analysis),
      outcome.provider,
      outcome.model,
      ts,
      id
    );
  });

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
