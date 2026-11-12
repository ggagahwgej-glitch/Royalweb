import 'server-only';
import fs from 'node:fs';
import { all, get, newId, nowIso, run, tx } from '@/lib/db';
import { getAdapter } from '@/lib/platforms';
import { analyzePoster, generateContent } from '@/lib/ai';
import { contentFingerprint } from '@/lib/content-hash';
import { absoluteMediaPath } from '@/lib/media/storage';
import type { AppSettings } from '@/lib/settings';
import type { PlatformAdapter } from '@/lib/platforms/types';

/**
 * Generation pipeline shared by the HTTP route, RSS ingestion and evergreen
 * recycling — so "generate 25 drafts" behaves identically wherever it starts.
 * Drafts are always written with status `draft`: nothing is published, and an
 * operator still has to approve.
 */

export interface GenerateOptions {
  userId: string;
  campaignId: string;
  settings: AppSettings;
  adapters: PlatformAdapter[];
  /** Used to attribute ai_activity_logs to a user. */
  source?: string;
}

export async function generateForCampaign(options: GenerateOptions) {
  const { userId, campaignId, settings, adapters } = options;
  const campaign = get<Record<string, unknown>>(
    'SELECT * FROM campaigns WHERE id = ? AND user_id = ?',
    campaignId,
    userId
  );
  if (!campaign) throw new Error('Campaign not found');

  const media = all<{ id: string; filename: string; kind: string }>(
    "SELECT id, filename, kind FROM media_assets WHERE campaign_id = ? AND deleted_at IS NULL AND kind = 'image' ORDER BY created_at",
    campaignId
  );
  if (!media.length) throw new Error('No poster attached to this campaign');

  const posterBuffer = fs.readFileSync(absoluteMediaPath(media[0].filename));
  const analysis = await analyzePoster(posterBuffer, settings, { campaignId });

  const campaignInput = {
    id: campaignId,
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
    userId,
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
      const existing = get<{ id: string }>(
        'SELECT id FROM generated_contents WHERE campaign_id = ? AND platform_id = ?',
        campaignId,
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
          campaignId,
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
      `UPDATE campaigns SET analysis_json = ?, ai_provider = ?, ai_model = ?,
         status = CASE WHEN status = 'draft' THEN 'ready' ELSE status END, updated_at = ?
       WHERE id = ?`,
      JSON.stringify(analysis),
      outcome.provider,
      outcome.model,
      ts,
      campaignId
    );
  });

  return {
    contents: all(
      `SELECT gc.*, p.name AS platform_name, p.automation FROM generated_contents gc
         JOIN platforms p ON p.id = gc.platform_id WHERE gc.campaign_id = ? ORDER BY p.sort_order`,
      campaignId
    ),
    mode: outcome.mode,
    provider: outcome.provider,
    model: outcome.model,
    notices: outcome.notices,
    analysis,
  };
}
