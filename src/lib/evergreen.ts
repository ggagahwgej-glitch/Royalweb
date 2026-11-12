import 'server-only';
import crypto from 'node:crypto';
import { all, get, newId, nowIso, run, tx } from '@/lib/db';
import { ADAPTERS, getAdapter } from '@/lib/platforms';
import { getSettings } from '@/lib/settings';
import { generateForCampaign } from '@/lib/generate';
import { resolveProvider } from '@/lib/ai/providers';
import { contentFingerprint } from '@/lib/content-hash';
import { absoluteMediaPath, readMedia, saveOriginal } from '@/lib/media/storage';

/**
 * Evergreen recycling.
 *
 * A campaign that finished well can be offered again later instead of rewritten
 * from scratch. The rules are deliberately conservative:
 *
 *  - only campaigns the operator marked (`recycle_after_days > 0`),
 *  - only `completed` campaigns older than that window,
 *  - the clone is a **draft** with unapproved content — recycling never
 *    publishes by itself,
 *  - the copy is genuinely varied (new opener, new angle) and labelled
 *    `recycled`, so a re-post is not a byte-identical duplicate,
 *  - the source campaign is marked recycled and will not queue again.
 */

const OPENERS = [
  'Still true:',
  'Bringing this back —',
  'One more time, because it matters:',
  'If you missed it the first time:',
  'Worth repeating:',
  'This keeps coming up:',
];

const ANGLES = [
  'If your website still looks like 2019, this is the fix.',
  'A fast mobile site is the cheapest marketing you will ever buy.',
  'Every week without a working site is a customer calling someone else.',
  'The enquiry you lost this week probably came from a phone.',
  'You do not need a bigger ad budget — you need a page that loads.',
];

function pick(seed: string): { opener: string; angle: string } {
  const hash = crypto.createHash('sha256').update(seed).digest();
  return {
    opener: OPENERS[hash[0] % OPENERS.length],
    angle: ANGLES[hash[1] % ANGLES.length],
  };
}

export interface RecycleResult {
  campaignId: string;
  sourceCampaignId: string;
  contents: number;
  mode: 'regenerated' | 'varied';
}

export async function recycleCampaign(sourceCampaignId: string, userId: string): Promise<RecycleResult> {
  const source = get<Record<string, unknown>>(
    'SELECT * FROM campaigns WHERE id = ? AND user_id = ?',
    sourceCampaignId,
    userId
  );
  if (!source) throw new Error('Campaign not found');

  const workspaceId = source.workspace_id ? String(source.workspace_id) : undefined;
  const settings = getSettings(userId, workspaceId);
  const campaignId = newId();
  const ts = nowIso();
  const { opener, angle } = pick(sourceCampaignId);

  run(
    `INSERT INTO campaigns (id, user_id, name, business_category, service_name, offer_price, website_url,
       whatsapp_url, contact_info, description, target_audience, language, cta, status, timezone, recurrence,
       workspace_id, recycled_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, 'none', ?, ?, ?, ?)`,
    campaignId,
    userId,
    `${String(source.name ?? 'Campaign').slice(0, 120)} · recycled`,
    String(source.business_category ?? ''),
    String(source.service_name ?? ''),
    String(source.offer_price ?? ''),
    String(source.website_url ?? ''),
    String(source.whatsapp_url ?? ''),
    String(source.contact_info ?? ''),
    String(source.description ?? ''),
    String(source.target_audience ?? ''),
    String(source.language ?? 'English'),
    String(source.cta ?? ''),
    String(source.timezone ?? 'Asia/Kolkata'),
    source.workspace_id ?? null,
    sourceCampaignId,
    ts,
    ts
  );

  // Copy the poster file (never share one file between two campaigns — deleting
  // one campaign must not remove the other's image).
  const media = get<Record<string, unknown>>(
    'SELECT * FROM media_assets WHERE campaign_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1',
    sourceCampaignId
  );
  let hasMedia = false;
  if (media) {
    try {
      const buffer = readMedia(String(media.filename));
      const filename = saveOriginal(buffer, String(media.original_name ?? 'poster.jpg'));
      run(
        `INSERT INTO media_assets (id, user_id, campaign_id, original_name, filename, mime, bytes, width, height,
           kind, sha256, analysis_json, workspace_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        userId,
        campaignId,
        String(media.original_name ?? 'poster.jpg'),
        filename,
        String(media.mime ?? 'image/jpeg'),
        buffer.length,
        media.width ?? null,
        media.height ?? null,
        String(media.kind ?? 'image'),
        crypto.createHash('sha256').update(buffer).digest('hex'),
        String(media.analysis_json ?? '{}'),
        media.workspace_id ?? null,
        ts
      );
      hasMedia = true;
    } catch (err) {
      console.error('[evergreen] poster copy failed', (err as Error).message, absoluteMediaPath(String(media.filename)));
    }
  }

  let contents = 0;
  let mode: RecycleResult['mode'] = 'varied';

  // Regenerate only with a real AI provider. With the template engine the output
  // would be byte-identical, which is exactly the duplicate we are avoiding.
  const provider = resolveProvider(settings.aiProvider, settings.aiModel);
  if (hasMedia && provider) {
    try {
      const outcome = await generateForCampaign({
        userId,
        campaignId,
        settings,
        adapters: ADAPTERS,
        source: 'recycle',
      });
      contents = outcome.contents.length;
      if (contents > 0) mode = 'regenerated';
    } catch (err) {
      console.error('[evergreen] regeneration failed, falling back to variation:', (err as Error).message);
    }
  }

  if (contents === 0) {
    const previous = all<Record<string, unknown>>(
      'SELECT * FROM generated_contents WHERE campaign_id = ? ORDER BY platform_id',
      sourceCampaignId
    );
    tx(() => {
      for (const row of previous) {
        const adapter = getAdapter(String(row.platform_id));
        if (!adapter) continue;
        let extra: Record<string, unknown> = {};
        try {
          extra = JSON.parse(String(row.extra_json ?? '{}')) as Record<string, unknown>;
        } catch {
          extra = {};
        }
        const title = `${opener} ${String(row.title ?? '')}`.slice(0, adapter.limits.title);
        const caption = `${opener} ${String(row.caption ?? '')}`.slice(0, adapter.limits.caption);
        const description = `${String(row.description ?? '')}\n\n${angle}`.slice(0, adapter.limits.caption);
        let hashtags: string[] = [];
        try {
          const parsed = JSON.parse(String(row.hashtags_json ?? '[]'));
          if (Array.isArray(parsed)) hashtags = parsed.map(String);
        } catch {
          hashtags = [];
        }
        run(
          `INSERT INTO generated_contents (id, campaign_id, platform_id, title, caption, description, hashtags_json,
             cta, destination_url, alt_text, extra_json, status, content_hash, generator, model, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, 'recycled', 'royalweb-recycle-v1', 1, ?, ?)`,
          newId(),
          campaignId,
          String(row.platform_id),
          title,
          caption,
          description,
          JSON.stringify(hashtags),
          String(row.cta ?? ''),
          String(row.destination_url ?? ''),
          String(row.alt_text ?? ''),
          JSON.stringify({ ...extra, recycledFrom: sourceCampaignId }),
          contentFingerprint({ platform: String(row.platform_id), title, caption, description, hashtags }),
          ts,
          ts
        );
      }
    });
    contents = previous.length;
  }

  run('UPDATE campaigns SET recycle_after_days = 0, updated_at = ? WHERE id = ?', ts, sourceCampaignId);

  return { campaignId, sourceCampaignId, contents, mode };
}

export function dueForRecycling(limit = 5, userId?: string) {
  const rows = all<{ id: string; user_id: string; name: string; recycle_after_days: number; updated_at: string }>(
    `SELECT id, user_id, name, recycle_after_days, updated_at FROM campaigns
      WHERE status = 'completed' AND recycle_after_days > 0 ${userId ? 'AND user_id = ?' : ''}
      ORDER BY updated_at LIMIT 50`,
    ...((userId ? [userId] : []) as never[])
  );
  return rows
    .filter((row) => {
      const ageDays = (Date.now() - new Date(row.updated_at).getTime()) / 86_400_000;
      return ageDays >= Number(row.recycle_after_days);
    })
    .slice(0, limit)
    .map((row) => ({ id: row.id, user_id: row.user_id, name: row.name }));
}

export async function recycleDueCampaigns(limit = 3): Promise<number> {
  let recycled = 0;
  for (const row of dueForRecycling(limit)) {
    try {
      await recycleCampaign(row.id, row.user_id);
      recycled += 1;
    } catch (err) {
      console.error('[evergreen] recycle failed', row.id, err);
    }
  }
  return recycled;
}

export function setRecycleWindow(campaignId: string, userId: string, days: number) {
  const clamped = Math.max(0, Math.min(Math.round(days), 365));
  const res = run(
    'UPDATE campaigns SET recycle_after_days = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    clamped,
    nowIso(),
    campaignId,
    userId
  );
  return Number(res.changes) > 0 ? clamped : null;
}
