import { z } from 'zod';
import { handler, jsonOk, parseBody, audit, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { addFeed, ingestFeed, listFeeds, recentItems, removeFeed } from '@/lib/rss';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export const GET = handler(async (_req, _ctx, auth) => {
  return jsonOk({
    feeds: listFeeds(auth.workspaceId, auth.user.id),
    items: recentItems(auth.user.id, 20),
    note: 'New articles become draft campaigns with 25 generated drafts. Nothing is scheduled or published until you approve it.',
  });
});

const bodySchema = z.object({
  action: z.enum(['add', 'ingest', 'remove']),
  url: z.string().url().max(500).optional(),
  label: z.string().max(120).optional(),
  autoGenerate: z.boolean().optional(),
  feedId: z.string().uuid().optional(),
});

export const POST = handler(async (req, _ctx, auth) => {
  const body = await parseBody(req, bodySchema);
  enforceRateLimit(`rss:${auth.user.id}`, 30, 600);

  if (body.action === 'add') {
    if (!body.url) throw new ApiError(400, 'A feed URL is required', 'missing_url');
    try {
      const feed = addFeed({
        userId: auth.user.id,
        workspaceId: auth.workspaceId,
        url: body.url,
        label: body.label,
        autoGenerate: body.autoGenerate,
      });
      await audit('rss.feed_added', 'rss_feed', String(feed?.id ?? ''), auth.user.id, { url: body.url });
      const first = await ingestFeed(String(feed?.id ?? ''), { maxItems: 2 });
      return jsonOk({ feeds: listFeeds(auth.workspaceId, auth.user.id), ingest: first });
    } catch (err) {
      throw new ApiError(400, (err as Error).message, 'feed_error');
    }
  }

  if (body.action === 'ingest') {
    if (!body.feedId) throw new ApiError(400, 'feedId is required', 'missing_feed');
    const result = await ingestFeed(body.feedId, { maxItems: 3 });
    await audit('rss.ingested', 'rss_feed', body.feedId, auth.user.id, {
      newItems: result.newItems,
      drafted: result.drafted,
    });
    return jsonOk({ ingest: result, feeds: listFeeds(auth.workspaceId, auth.user.id), items: recentItems(auth.user.id, 20) });
  }

  if (!body.feedId) throw new ApiError(400, 'feedId is required', 'missing_feed');
  const removed = removeFeed(auth.user.id, body.feedId);
  await audit('rss.feed_removed', 'rss_feed', body.feedId, auth.user.id, { removed });
  return jsonOk({ removed, feeds: listFeeds(auth.workspaceId, auth.user.id) });
});
