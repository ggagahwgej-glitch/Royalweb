import 'server-only';
import crypto from 'node:crypto';
import { all, get, newId, nowIso, run } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { ADAPTERS } from '@/lib/platforms';
import { generateForCampaign } from '@/lib/generate';
import { saveOriginal } from '@/lib/media/storage';
import { analyzeImage } from '@/lib/media/process';
import { raiseAlert } from '@/lib/alerts';

/**
 * RSS / blog ingestion.
 *
 * A feed is polled on the supervisor interval. New items become a campaign with
 * the article's own lead image, and 25 drafts are generated and left in `draft`
 * — nothing is scheduled and nothing is published without approval.
 *
 * Deliberate limits: 10 new items per poll, 8 MB per image, http(s) only, no
 * redirects to private address space, and no item is ever imported twice (the
 * GUID/link hash is unique per feed).
 */

export interface FeedItem {
  guid: string;
  title: string;
  link: string;
  summary: string;
  publishedAt: string | null;
  imageUrl: string | null;
}

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const match = re.exec(block);
  return match ? decodeEntities(match[1]).trim() : '';
}

function attr(block: string, name: string, attrName: string): string {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?${attrName}=["']([^"']+)["'][^>]*>`, 'i');
  return re.exec(block)?.[1]?.trim() ?? '';
}

function extractImage(block: string, summaryHtml: string): string | null {
  const enclosure = attr(block, 'enclosure', 'url');
  if (enclosure && /\.(jpe?g|png|webp)(\?|$)/i.test(enclosure)) return enclosure;
  const media = attr(block, 'media:content', 'url') || attr(block, 'media:thumbnail', 'url');
  if (media) return media;
  const img = /<img[^>]+src=["']([^"']+)["']/i.exec(summaryHtml)?.[1];
  return img ?? null;
}

/** Minimal, dependency-free RSS 2.0 / Atom parser. */
export function parseFeed(xml: string): { title: string; items: FeedItem[] } {
  const feedTitle = stripTags(tag(xml, 'channel') ? tag(tag(xml, 'channel'), 'title') : tag(xml, 'title'));
  const rawItems = [
    ...(xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? []),
    ...(xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? []),
  ];
  const items: FeedItem[] = [];
  for (const block of rawItems.slice(0, 50)) {
    const rawTitle = tag(block, 'title');
    const rawLink = tag(block, 'link') || attr(block, 'link', 'href');
    const summaryHtml = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content');
    const guidRaw = tag(block, 'guid') || tag(block, 'id') || rawLink || rawTitle;
    const published = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    if (!rawTitle && !rawLink) continue;
    items.push({
      guid: guidRaw || rawLink || rawTitle,
      title: stripTags(rawTitle).slice(0, 300),
      link: rawLink,
      summary: stripTags(summaryHtml).slice(0, 1500),
      publishedAt: published ? new Date(published).toISOString() : null,
      imageUrl: extractImage(block, summaryHtml),
    });
  }
  return { title: feedTitle, items };
}

function assertPublicUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${label} must be http(s)`);
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^169\.254\./.test(host) ||
    host.endsWith('.local') ||
    host === '::1'
  ) {
    // SSRF guard. A feed URL is operator input, not arbitrary user input, but
    // the same code path fetches item images, so keep the rule uniform.
    if (process.env.ROYALWEB_ALLOW_PRIVATE_FETCH !== '1') {
      throw new Error(`${label} points at a private address (${host}). Set ROYALWEB_ALLOW_PRIVATE_FETCH=1 for internal feeds.`);
    }
  }
  return url;
}

export function listFeeds(workspaceId: string, userId: string) {
  return all<Record<string, unknown>>(
    `SELECT f.*, (SELECT COUNT(*) FROM rss_items i WHERE i.feed_id = f.id) AS item_count,
            (SELECT COUNT(*) FROM rss_items i WHERE i.feed_id = f.id AND i.campaign_id IS NOT NULL) AS drafted_count
       FROM rss_feeds f
      WHERE f.user_id = ? AND (f.workspace_id = ? OR f.workspace_id IS NULL)
      ORDER BY f.created_at DESC`,
    userId,
    workspaceId
  ).map((r) => ({
    id: String(r.id),
    url: String(r.url),
    label: String(r.label),
    enabled: Boolean(Number(r.enabled ?? 1)),
    autoGenerate: Boolean(Number(r.auto_generate ?? 1)),
    lastCheckedAt: r.last_checked_at ? String(r.last_checked_at) : null,
    lastError: r.last_error ? String(r.last_error) : null,
    lastItemAt: r.last_item_at ? String(r.last_item_at) : null,
    itemCount: Number(r.item_count ?? 0),
    draftedCount: Number(r.drafted_count ?? 0),
    createdAt: String(r.created_at),
  }));
}

export function addFeed(input: { userId: string; workspaceId: string; url: string; label?: string; autoGenerate?: boolean }) {
  const url = assertPublicUrl(input.url, 'Feed URL').toString();
  const id = newId();
  run(
    `INSERT INTO rss_feeds (id, user_id, workspace_id, url, label, enabled, auto_generate, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(workspace_id, url) DO UPDATE SET enabled = 1, label = excluded.label`,
    id,
    input.userId,
    input.workspaceId,
    url,
    (input.label ?? '').slice(0, 120),
    input.autoGenerate === false ? 0 : 1,
    nowIso()
  );
  return get<Record<string, unknown>>('SELECT * FROM rss_feeds WHERE user_id = ? AND url = ?', input.userId, url);
}

export function removeFeed(userId: string, feedId: string) {
  run('DELETE FROM rss_items WHERE feed_id = ?', feedId);
  const res = run('DELETE FROM rss_feeds WHERE id = ? AND user_id = ?', feedId, userId);
  return Number(res.changes) > 0;
}

async function downloadImage(url: string, pageUrl: string): Promise<{ buffer: Buffer; filename: string } | null> {
  try {
    const absolute = new URL(url, pageUrl).toString();
    assertPublicUrl(absolute, 'Article image');
    const res = await fetch(absolute, {
      headers: { 'user-agent': 'ROYALWEB-AUTOPILOT/1.0 (+feed ingest)', accept: 'image/*' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!/^image\/(jpeg|jpg|png|webp)/i.test(type)) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) return null;
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    return { buffer, filename: `feed-${crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12)}.${ext}` };
  } catch {
    return null;
  }
}

export interface IngestResult {
  feedId: string;
  newItems: number;
  drafted: number;
  skipped: { title: string; reason: string }[];
  error?: string;
}

export async function ingestFeed(feedId: string, options: { maxItems?: number } = {}): Promise<IngestResult> {
  const feed = get<Record<string, unknown>>('SELECT * FROM rss_feeds WHERE id = ?', feedId);
  const result: IngestResult = { feedId, newItems: 0, drafted: 0, skipped: [] };
  if (!feed) {
    result.error = 'Feed not found';
    return result;
  }
  const userId = String(feed.user_id);
  const workspaceId = String(feed.workspace_id ?? '');
  const maxItems = Math.min(options.maxItems ?? 3, 10);

  let parsed: { title: string; items: FeedItem[] };
  try {
    const res = await fetch(String(feed.url), {
      headers: { 'user-agent': 'ROYALWEB-AUTOPILOT/1.0 (+feed ingest)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
    parsed = parseFeed(await res.text());
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    run(
      'UPDATE rss_feeds SET last_checked_at = ?, last_error = ? WHERE id = ?',
      nowIso(),
      message,
      feedId
    );
    result.error = message;
    await raiseAlert({
      code: 'rss_failed',
      title: 'RSS feed could not be read',
      detail: `${String(feed.url)} — ${message}. Drafts will not be created for new articles until the feed loads again.`,
      dedupeMinutes: 360,
      workspaceId: workspaceId || null,
      meta: { feedId },
    });
    return result;
  }

  // Oldest-first so a backlog is drafted in publication order.
  const fresh: FeedItem[] = [];
  for (const item of parsed.items.slice().reverse()) {
    const guidHash = crypto.createHash('sha256').update(item.guid || item.link || item.title).digest('hex');
    const exists = get('SELECT 1 FROM rss_items WHERE feed_id = ? AND guid_hash = ?', feedId, guidHash);
    if (exists) continue;
    fresh.push(item);
    if (fresh.length >= maxItems) break;
  }

  for (const item of fresh) {
    const guidHash = crypto.createHash('sha256').update(item.guid || item.link || item.title).digest('hex');
    const itemId = newId();
    run(
      `INSERT INTO rss_items (id, feed_id, guid_hash, title, link, summary, published_at, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)
       ON CONFLICT(feed_id, guid_hash) DO NOTHING`,
      itemId,
      feedId,
      guidHash,
      item.title,
      item.link,
      item.summary,
      item.publishedAt,
      nowIso()
    );
    result.newItems += 1;

    if (!Number(feed.auto_generate ?? 1)) {
      run("UPDATE rss_items SET state = 'skipped', error = ? WHERE id = ?", 'Auto-generate is off for this feed', itemId);
      result.skipped.push({ title: item.title, reason: 'auto-generate off' });
      continue;
    }

    const image = item.imageUrl ? await downloadImage(item.imageUrl, item.link || String(feed.url)) : null;
    if (!image) {
      run(
        "UPDATE rss_items SET state = 'skipped', error = ? WHERE id = ?",
        'The article has no usable lead image. Add a poster to the item manually to generate drafts.',
        itemId
      );
      result.skipped.push({ title: item.title, reason: 'no lead image' });
      continue;
    }

    try {
      const settings = getSettings(userId, workspaceId || undefined);
      const campaignId = newId();
      const ts = nowIso();
      run(
        `INSERT INTO campaigns (id, user_id, name, business_category, service_name, offer_price, website_url,
           whatsapp_url, contact_info, description, target_audience, language, cta, status, timezone, recurrence,
           workspace_id, source_feed_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, '', '', ?, ?, ?, ?, 'draft', ?, 'none', ?, ?, ?, ?)`,
        campaignId,
        userId,
        item.title.slice(0, 150) || 'RSS article',
        'Blog article',
        item.title.slice(0, 150),
        settings.websiteUrl,
        `${item.summary}${item.summary ? ' ' : ''}Source: ${item.link}`.slice(0, 4000),
        settings.targetCustomers.join(', '),
        settings.defaultLanguage,
        settings.ctaPrimary,
        settings.defaultTimezone,
        workspaceId || null,
        feedId,
        ts,
        ts
      );

      const filename = saveOriginal(image.buffer, image.filename);
      const analysis = await analyzeImage(image.buffer);
      const mime = /\.png$/i.test(image.filename)
        ? 'image/png'
        : /\.webp$/i.test(image.filename)
          ? 'image/webp'
          : 'image/jpeg';
      run(
        `INSERT INTO media_assets (id, user_id, campaign_id, original_name, filename, mime, bytes, width, height,
           kind, sha256, analysis_json, workspace_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'image', ?, ?, ?, ?)`,
        newId(),
        userId,
        campaignId,
        image.filename,
        filename,
        mime,
        image.buffer.length,
        analysis.width,
        analysis.height,
        crypto.createHash('sha256').update(image.buffer).digest('hex'),
        JSON.stringify(analysis),
        workspaceId || null,
        ts
      );

      const outcome = await generateForCampaign({
        userId,
        campaignId,
        settings,
        adapters: ADAPTERS,
        source: 'rss',
      });

      run(
        "UPDATE rss_items SET state = 'drafted', campaign_id = ? WHERE id = ?",
        campaignId,
        itemId
      );
      run('UPDATE rss_feeds SET last_item_at = ? WHERE id = ?', nowIso(), feedId);
      result.drafted += 1;
      if (outcome.contents.length !== 25) {
        result.skipped.push({ title: item.title, reason: `only ${outcome.contents.length} drafts generated` });
      }
    } catch (err) {
      run(
        "UPDATE rss_items SET state = 'failed', error = ? WHERE id = ?",
        (err as Error).message.slice(0, 500),
        itemId
      );
      result.skipped.push({ title: item.title, reason: (err as Error).message });
    }
  }

  run(
    'UPDATE rss_feeds SET last_checked_at = ?, last_error = NULL, items_seen = (SELECT COUNT(*) FROM rss_items WHERE feed_id = ?) WHERE id = ?',
    nowIso(),
    feedId,
    feedId
  );
  return result;
}

/** Poll every enabled feed that is due. Used by the background supervisor. */
export async function pollDueFeeds(limit = 5): Promise<{ checked: number; items: number; drafted: number }> {
  const feeds = all<{ id: string }>(
    `SELECT id FROM rss_feeds
      WHERE enabled = 1 AND (last_checked_at IS NULL OR last_checked_at < ?)
      ORDER BY COALESCE(last_checked_at, '1970-01-01') LIMIT ?`,
    new Date(Date.now() - 15 * 60_000).toISOString(),
    limit
  );
  let items = 0;
  let drafted = 0;
  for (const feed of feeds) {
    const outcome = await ingestFeed(feed.id, { maxItems: 2 });
    items += outcome.newItems;
    drafted += outcome.drafted;
  }
  return { checked: feeds.length, items, drafted };
}

export function recentItems(userId: string, limit = 20) {
  return all<Record<string, unknown>>(
    `SELECT i.*, f.label AS feed_label, f.url AS feed_url, c.name AS campaign_name
       FROM rss_items i JOIN rss_feeds f ON f.id = i.feed_id
       LEFT JOIN campaigns c ON c.id = i.campaign_id
      WHERE f.user_id = ? ORDER BY i.created_at DESC LIMIT ?`,
    userId,
    limit
  ).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    link: String(r.link),
    state: String(r.state),
    error: r.error ? String(r.error) : null,
    campaignId: r.campaign_id ? String(r.campaign_id) : null,
    campaignName: r.campaign_name ? String(r.campaign_name) : null,
    feedLabel: String(r.feed_label ?? r.feed_url),
    createdAt: String(r.created_at),
  }));
}
