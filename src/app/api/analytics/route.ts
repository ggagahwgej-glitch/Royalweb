import { handler, jsonOk } from '@/lib/api';
import { all, get } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Analytics are computed only from data ROYALWEB actually owns: uploads, jobs,
 * published results and manual tasks. No engagement metrics are invented —
 * platforms do not expose impressions/likes here, so those are explicitly
 * reported as unavailable rather than as zero.
 */
export const GET = handler(async (_req, _ctx, auth) => {
  const one = (sql: string, ...params: unknown[]) => Number(get<{ c: number }>(sql, ...params)?.c ?? 0);
  const userId = auth.user.id;

  const totals = {
    campaigns: one('SELECT COUNT(*) AS c FROM campaigns WHERE user_id = ?', userId),
    media: one('SELECT COUNT(*) AS c FROM media_assets WHERE user_id = ? AND deleted_at IS NULL', userId),
    contents: one(
      'SELECT COUNT(*) AS c FROM generated_contents gc JOIN campaigns c ON c.id = gc.campaign_id WHERE c.user_id = ?',
      userId
    ),
    published: one(
      'SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id WHERE c.user_id = ? AND j.status = \'published\'',
      userId
    ),
    scheduled: one(
      'SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id WHERE c.user_id = ? AND j.status = \'scheduled\'',
      userId
    ),
    processing: one(
      'SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id WHERE c.user_id = ? AND j.status = \'processing\'',
      userId
    ),
    failed: one(
      'SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id WHERE c.user_id = ? AND j.status IN (\'failed\',\'connection_expired\')',
      userId
    ),
    manualPending: one(
      'SELECT COUNT(*) AS c FROM manual_tasks mt JOIN campaigns c ON c.id = mt.campaign_id WHERE c.user_id = ? AND mt.status = \'pending\'',
      userId
    ),
    manualPublished: one(
      'SELECT COUNT(*) AS c FROM manual_tasks mt JOIN campaigns c ON c.id = mt.campaign_id WHERE c.user_id = ? AND mt.status = \'published\'',
      userId
    ),
    connectedPlatforms: one(
      "SELECT COUNT(DISTINCT platform_id) AS c FROM connected_accounts WHERE user_id = ? AND status = 'connected'",
      userId
    ),
    connectedAccounts: one(
      "SELECT COUNT(*) AS c FROM connected_accounts WHERE user_id = ? AND status = 'connected'",
      userId
    ),
    platforms: one('SELECT COUNT(*) AS c FROM platforms'),
  };

  const platformActivity = all<Record<string, unknown>>(
    `SELECT p.id, p.name, p.grp, p.automation, p.enabled, p.credential_status, p.last_activity_at, p.last_error,
       (SELECT COUNT(*) FROM connected_accounts a WHERE a.platform_id = p.id AND a.user_id = ? AND a.status = 'connected') AS accounts,
       (SELECT COUNT(*) FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
          WHERE j.platform_id = p.id AND c.user_id = ? AND j.status = 'published') AS published,
       (SELECT COUNT(*) FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
          WHERE j.platform_id = p.id AND c.user_id = ? AND j.status = 'scheduled') AS scheduled,
       (SELECT COUNT(*) FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
          WHERE j.platform_id = p.id AND c.user_id = ? AND j.status IN ('failed','connection_expired')) AS failed,
       (SELECT COUNT(*) FROM manual_tasks mt JOIN campaigns c ON c.id = mt.campaign_id
          WHERE mt.platform_id = p.id AND c.user_id = ? AND mt.status = 'published') AS manual_published
     FROM platforms p
     ORDER BY p.sort_order`,
    userId,
    userId,
    userId,
    userId,
    userId
  );

  const daily = all(
    `SELECT substr(j.updated_at, 1, 10) AS day, j.status, COUNT(*) AS c
       FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
      WHERE c.user_id = ? AND j.updated_at > ?
      GROUP BY day, j.status ORDER BY day DESC`,
    userId,
    new Date(Date.now() - 30 * 86400_000).toISOString()
  );

  const recent = all(
    `SELECT j.id, j.status, j.error, j.published_url, j.scheduled_at, j.updated_at,
            p.name AS platform_name, c.name AS campaign_name
       FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
       JOIN platforms p ON p.id = j.platform_id
      WHERE c.user_id = ? ORDER BY j.updated_at DESC LIMIT 25`,
    userId
  );

  const manualByPlatform = all(
    `SELECT p.name, mt.status, COUNT(*) AS c FROM manual_tasks mt
       JOIN campaigns c ON c.id = mt.campaign_id JOIN platforms p ON p.id = mt.platform_id
      WHERE c.user_id = ? GROUP BY p.name, mt.status`,
    userId
  );

  return jsonOk({
    totals,
    platformActivity,
    daily,
    recent,
    manualByPlatform,
    engagement: {
      available: false,
      reason:
        'Impressions, reach, clicks, likes and views are not exposed by these platform APIs to this app, so ROYALWEB does not display them. Values are unavailable, not zero.',
      metrics: [],
    },
    generatedAt: new Date().toISOString(),
  });
});
