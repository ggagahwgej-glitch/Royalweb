import 'server-only';
import { newId, nowIso, run } from '@/lib/db';
import type { PlatformAdapter } from '@/lib/platforms/types';
import type { AppSettings } from '@/lib/settings';
import { businessProfile } from '@/lib/settings';
import { buildPlatformImage, analyzeImage, presetFor } from '@/lib/media/process';
import { generateLocalContent, localHashtags } from './local';
import type { AiPart, GeneratedContent, PosterAnalysis } from './types';
import { AiNotConfiguredError } from './types';
import { resolveProvider } from './providers';

export interface CampaignInput {
  id: string;
  name: string;
  businessCategory: string;
  serviceName: string;
  offerPrice: string;
  websiteUrl: string;
  whatsappUrl: string;
  contactInfo: string;
  description: string;
  targetAudience: string;
  language: string;
  cta: string;
}

function logAi(entry: {
  userId?: string;
  campaignId?: string;
  kind: string;
  provider: string;
  model?: string;
  ok: boolean;
  error?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  meta?: Record<string, unknown>;
}) {
  run(
    `INSERT INTO ai_activity_logs (id, user_id, campaign_id, kind, provider, model, ok, error,
       prompt_tokens, completion_tokens, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    entry.userId ?? null,
    entry.campaignId ?? null,
    entry.kind,
    entry.provider,
    entry.model ?? '',
    entry.ok ? 1 : 0,
    entry.error ?? null,
    entry.usage?.promptTokens ?? null,
    entry.usage?.completionTokens ?? null,
    JSON.stringify(entry.meta ?? {}),
    nowIso()
  );
}

/** Local (no-AI) image analysis. Real measurements from the uploaded file. */
async function localAnalysis(buffer: Buffer): Promise<PosterAnalysis> {
  const stats = await analyzeImage(buffer);
  return {
    summary: `A ${stats.orientation} ${stats.format.toUpperCase()} graphic (${stats.width}×${stats.height}) with a dominant colour of ${stats.dominantColor}. Text on the poster was not read because no AI vision provider is configured.`,
    service: '',
    offer: '',
    audience: '',
    cta: '',
    brandColors: stats.palette,
    textOnPoster: '',
    source: 'local-image-analysis',
    image: {
      width: stats.width,
      height: stats.height,
      format: stats.format,
      orientation: stats.orientation,
      dominantColor: stats.dominantColor,
      brightness: stats.brightness,
    },
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI response did not contain JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Analyse the uploaded poster. With a vision-capable model the actual artwork
 * is read; without one, real image measurements are returned and clearly
 * labelled as not-AI so nothing is fabricated.
 */
export async function analyzePoster(
  buffer: Buffer,
  settings: AppSettings,
  opts: { campaignId?: string } = {}
): Promise<PosterAnalysis> {
  const base = await localAnalysis(buffer);
  const provider = resolveProvider(settings.aiProvider, settings.aiModel);
  if (!provider?.supportsVision) return base;

  try {
    const res = await provider.chat(
      [
        {
          role: 'system',
          content:
            'You are an expert marketing analyst. Read the promotional poster and describe it accurately. Only state what is visible. Never invent prices, names, phone numbers or claims that are not in the image.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyse this poster. Return ONLY JSON with keys: summary (1-2 sentences), service (what is being advertised), offer (price/offer text exactly as written, else ""), audience, cta, textOnPoster (the main headline/offer text you can read, verbatim, max 300 chars).`,
            },
            { type: 'image', mimeType: 'image/jpeg', dataBase64: buffer.toString('base64') },
          ],
        },
      ],
      { json: true, maxTokens: 700, temperature: 0.2 }
    );
    const parsed = extractJson(res.text) as Record<string, unknown>;
    const analysis: PosterAnalysis = {
      ...base,
      summary: String(parsed.summary ?? base.summary),
      service: String(parsed.service ?? ''),
      offer: String(parsed.offer ?? ''),
      audience: String(parsed.audience ?? ''),
      cta: String(parsed.cta ?? ''),
      textOnPoster: String(parsed.textOnPoster ?? ''),
      source: 'vision-model',
      provider: res.provider,
      model: res.model,
      brandColors: base.brandColors,
    };
    logAi({
      campaignId: opts.campaignId,
      kind: 'poster_analysis',
      provider: res.provider,
      model: res.model,
      ok: true,
      usage: res.usage,
    });
    return analysis;
  } catch (err) {
    logAi({
      campaignId: opts.campaignId,
      kind: 'poster_analysis',
      provider: provider.id,
      model: provider.defaultModel,
      ok: false,
      error: (err as Error).message.slice(0, 500),
    });
    return base;
  }
}

function sanitize(item: GeneratedContent, adapter: PlatformAdapter): GeneratedContent {
  const max = adapter.limits;
  const clip = (v: unknown, n: number) => {
    const s = String(v ?? '').trim();
    return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
  };
  const tags = Array.isArray(item.hashtags)
    ? [...new Set(item.hashtags.map((h) => String(h).replace(/^#/, '').replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean))]
    : [];
  return {
    platform: adapter.id,
    title: clip(item.title, max.title ?? 200),
    caption: clip(item.caption, max.caption),
    description: clip(item.description, Math.max(max.caption, 2000)),
    hashtags: tags.slice(0, max.hashtags ?? 5),
    cta: clip(item.cta, 160),
    altText: clip(item.altText || item.title, 300),
    extra: typeof item.extra === 'object' && item.extra ? item.extra : {},
  };
}

export interface GenerationOutcome {
  contents: GeneratedContent[];
  provider: string;
  model: string;
  mode: 'ai' | 'template' | 'mixed';
  notices: string[];
}

/**
 * Generate platform-specific content for every selected adapter.
 * One structured AI request is attempted; any platform it misses falls back to
 * the template engine so the user always gets an editable draft.
 */
export async function generateContent(input: {
  campaign: CampaignInput;
  settings: AppSettings;
  analysis: PosterAnalysis;
  adapters: PlatformAdapter[];
  posterBuffer?: Buffer;
  userId?: string;
}): Promise<GenerationOutcome> {
  const { campaign, settings, analysis, adapters } = input;
  const business = businessProfile(settings);
  const local = (adapter: PlatformAdapter) =>
    sanitize(
      generateLocalContent({ campaign, business, analysis, adapter }) as GeneratedContent,
      adapter
    );

  const provider = resolveProvider(settings.aiProvider, settings.aiModel);
  if (!provider) {
    const notices = [
      'Generated with the built-in ROYALWEB template engine. Configure an AI provider in Settings → AI to read poster text and write bespoke copy.',
    ];
    if (analysis.source === 'local-image-analysis') {
      notices.push(
        'Poster text was not read automatically: without a vision-capable AI provider only image measurements (size, colours, orientation) are available.'
      );
    }
    return {
      contents: adapters.map(local),
      provider: 'built-in template engine',
      model: 'royalweb-templates-v1',
      mode: 'template',
      notices,
    };
  }

  const platformBrief = adapters.map((a) => ({
    platform: a.id,
    name: a.name,
    style: a.contentHint,
    limits: a.limits,
    capabilities: a.capabilities,
  }));

  const userPayload = {
    business: {
      name: business.businessName,
      tagline: business.tagline,
      services: business.services,
      targetCustomers: business.targetCustomers,
      priceRange: business.priceMin && business.priceMax ? `${business.priceMin}-${business.priceMax} INR` : '',
      website: campaign.websiteUrl || business.websiteUrl,
      whatsapp: campaign.whatsappUrl || (business.publicContactVisible ? business.whatsappUrl : ''),
      cta: campaign.cta || business.ctaPrimary,
      language: campaign.language,
    },
    campaign: {
      name: campaign.name,
      category: campaign.businessCategory,
      service: campaign.serviceName,
      offerPrice: campaign.offerPrice,
      description: campaign.description,
      audience: campaign.targetAudience,
      contact: campaign.contactInfo,
    },
    posterAnalysis: analysis,
    platforms: platformBrief,
    rules: {
      jsonOnly: true,
      noInventedFacts: true,
      varyCaptionsPerPlatform: true,
      articlePlatforms: ['wordpress', 'blogger', 'ghost', 'devto', 'hashnode', 'behance', 'goodfirms'],
      neverRepeatSameCaption: true,
      returnShape:
        '{"items":[{"platform":"x","title":"","caption":"","description":"","hashtags":[""],"cta":"","altText":"","extra":{}}]}',
    },
  };

  try {
    const messageContent: AiPart[] = [{ type: 'text', text: JSON.stringify(userPayload) }];
    if (input.posterBuffer && provider.supportsVision) {
      messageContent.push({
        type: 'image',
        mimeType: 'image/jpeg',
        dataBase64: input.posterBuffer.toString('base64'),
      });
    }
    const res = await provider.chat(
      [
        {
          role: 'system',
          content: `You are ROYALWEB AUTOPILOT's senior social media strategist. You write distinct, platform-native marketing content for a website design business. You never invent facts: if a price, phone number or claim is not in the supplied data or visible on the poster, you leave it out. Return only valid JSON matching the requested shape. Keep within each platform's limits. Use the requested language (${campaign.language || 'English'}).`,
        },
        { role: 'user', content: messageContent },
      ],
      { json: true, maxTokens: 8000, temperature: 0.75 }
    );

    const parsed = extractJson(res.text) as { items?: GeneratedContent[] } | GeneratedContent[];
    const items = Array.isArray(parsed) ? parsed : parsed.items ?? [];
    const byPlatform = new Map(items.map((i) => [String(i.platform), i]));

    const contents: GeneratedContent[] = [];
    const missing: string[] = [];
    for (const adapter of adapters) {
      const found = byPlatform.get(adapter.id);
      if (found && (found.caption || found.description || found.title)) {
        contents.push(sanitize({ ...found, platform: adapter.id }, adapter));
      } else {
        missing.push(adapter.name);
        contents.push(local(adapter));
      }
    }

    logAi({
      userId: input.userId,
      campaignId: campaign.id,
      kind: 'content_generation',
      provider: res.provider,
      model: res.model,
      ok: true,
      usage: res.usage,
      meta: { platforms: adapters.map((a) => a.id), missing },
    });

    const notices: string[] = [];
    if (missing.length) {
      notices.push(`The AI did not return usable copy for ${missing.join(', ')} — the template engine filled those in. Review them before approving.`);
    }
    if (input.posterBuffer && provider.supportsVision) {
      notices.push('The AI analysed your poster image and generated platform-specific copy.');
    }
    return {
      contents,
      provider: res.provider,
      model: res.model,
      mode: missing.length ? 'mixed' : 'ai',
      notices,
    };
  } catch (err) {
    logAi({
      userId: input.userId,
      campaignId: campaign.id,
      kind: 'content_generation',
      provider: provider.id,
      model: provider.defaultModel,
      ok: false,
      error: (err as Error).message.slice(0, 500),
    });
    return {
      contents: adapters.map(local),
      provider: 'built-in template engine',
      model: 'royalweb-templates-v1',
      mode: 'template',
      notices: [
        `AI provider "${provider.label}" failed: ${(err as Error).message.slice(0, 300)}`,
        'Fell back to the built-in template engine. Fix the provider in Settings → AI and regenerate if you want AI copy.',
      ],
    };
  }
}

export async function preparePlatformImage(buffer: Buffer, platformId: string) {
  return buildPlatformImage(buffer, platformId);
}

export function platformPreset(platformId: string) {
  return presetFor(platformId);
}

export { localHashtags, AiNotConfiguredError };
export type { GeneratedContent, PosterAnalysis };
