import { handler, jsonOk } from '@/lib/api';
import { all, get } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Analytics are computed only from data ROYALWEB actually owns: uploads, jobs,
 * published results and manual tasks. No engagement metrics are invented —
 * platforms do not expose impressions/likes here, so those are explicitly
 * reported as unavailable rather than as zero.
 *
 * Every figure is scoped to the active workspace. A single operator can hold
 * several client workspaces, so counting by `user_id` alone would show one
 * client another client's campaign and publishing totals.
 */
export const GET = handler(async (_req, _ctx, auth) => {
  const one = (sql: string, ...params: unknown[]) => Number(get<{ c: number }>(sql, ...params)?.c ?? 0);
  const userId = auth.user.id;

  // Predicate + params for a table that carries workspace_id (campaigns, media,
  // accounts). Legacy NULL rows belong to the user's active workspace.
  const ws = (alias: string) =>
    `(${alias}.workspace_id = ? OR (${alias}.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))`;
  const scope: [string | null, string | null, string] = [auth.workspaceId, auth.workspaceId, userId];

  const totals = {
    campaigns: one(`SELECT COUNT(*) AS c FROM campaigns c WHERE c.user_id = ? AND ${ws('c')}`, userId, ...scope),
    media: one(
      `SELECT COUNT(*) AS c FROM media_assets m WHERE m.user_id = ? AND m.deleted_at IS NULL AND ${ws('m')}`,
      userId,
      ...scope
    ),
    contents: one(
      `SELECT COUNT(*) AS c FROM generated_contents gc JOIN campaigns c ON c.id = gc.campaign_id
        WHERE c.user_id = ? AND ${ws('c')}`,
      userId,
      ...scope
    ),
    published: one(
      `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
        WHERE c.user_id = ? AND j.status = 'published' AND ${ws('c')}`,
      userId,
      ...scope
    ),
    scheduled: one(
      `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
        WHERE c.user_id = ? AND j.status = 'scheduled' AND ${ws('c')}`,
      userId,
      ...scope
    ),
    processing: one(
      `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
        WHERE c.user_id = ? AND j.status = 'processing' AND ${ws('c')}`,
      userId,
      ...scope
    ),
    failed: one(
      `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
        WHERE c.user_id = ? AND j.status IN ('failed','connection_expired') AND ${ws('c')}`,
      userId,
      ...scope
    ),
    manualPending: one(
      `SELECT COUNT(*) AS c FROM manual_tasks mt JOIN campaigns c ON c.id = mt.campaign_id
        WHERE c.user_id = ? AND mt.status = 'pending' AND ${ws('c')}`,
      userId,
      ...scope
    ),
    manualPublished: one(
      `SELECT COUNT(*) AS c FROM manual_tasks mt JOIN campaigns c ON c.id = mt.campaign_id
        WHERE c.user_id = ? AND mt.status = 'published' AND ${ws('c')}`,
      userId,
      ...scope
    ),
    connectedPlatforms: one(
      `SELECT COUNT(DISTINCT a.platform_id) AS c FROM connected_accounts a
        WHERE a.user_id = ? AND a.status = 'connected' AND ${ws('a')}`,
      userId,
      ...scope
    ),
    connectedAccounts: one(
      `SELECT COUNT(*) AS c FROM connected_accounts a
        WHERE a.user_id = ? AND a.status = 'connected' AND ${ws('a')}`,
      userId,
      ...scope
    ),
    platforms: one('SELECT COUNT(*) AS c FROM platforms'),
  };

  const platformActivity = all<Record<string, unknown>>(
    `SELECT p.id, p.name, p.grp, p.automation, p.enabled, p.credential_status, p.last_activity_at, p.last_error,
       (SELECT COUNT(*) FROM connected_accounts a WHERE a.platform_id = p.id AND a.user_id = ? AND a.status = 'connected'
          AND ${ws('a')}) AS accounts,
       (SELECT COUNT(*) FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
          WHERE j.platform_id = p.id AND c.user_id = ? AND j.status = 'published' AND ${ws('c')}) AS published,
       (SELECT COUNT(*) FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
          WHERE j.platform_id = p.id AND c.user_id = ? AND j.status = 'scheduled' AND ${ws('c')}) AS scheduled,
       (SELECT COUNT(*) FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
          WHERE j.platform_id = p.id AND c.user_id = ? AND j.status IN ('failed','connection_expired') AND ${ws('c')}) AS failed,
       (SELECT COUNT(*) FROM manual_tasks mt JOIN campaigns c ON c.id = mt.campaign_id
          WHERE mt.platform_id = p.id AND c.user_id = ? AND mt.status = 'published' AND ${ws('c')}) AS manual_published
     FROM platforms p
     ORDER BY p.sort_order`,
    userId,
    ...scope,
    userId,
    ...scope,
    userId,
    ...scope,
    userId,
    ...scope,
    userId,
    ...scope
  );

  const daily = all(
    `SELECT substr(j.updated_at, 1, 10) AS day, j.status, COUNT(*) AS c
       FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
      WHERE c.user_id = ? AND j.updated_at > ? AND ${ws('c')}
      GROUP BY day, j.status ORDER BY day DESC`,
    userId,
    new Date(Date.now() - 30 * 86400_000).toISOString(),
    ...scope
  );

  const recent = all(
    `SELECT j.id, j.status, j.error, j.published_url, j.scheduled_at, j.updated_at,
            p.name AS platform_name, c.name AS campaign_name
       FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
       JOIN platforms p ON p.id = j.platform_id
      WHERE c.user_id = ? AND ${ws('c')} ORDER BY j.updated_at DESC LIMIT 25`,
    userId,
    ...scope
  );

  const manualByPlatform = all(
    `SELECT p.name, mt.status, COUNT(*) AS c FROM manual_tasks mt
       JOIN campaigns c ON c.id = mt.campaign_id JOIN platforms p ON p.id = mt.platform_id
      WHERE c.user_id = ? AND ${ws('c')} GROUP BY p.name, mt.status`,
    userId,
    ...scope
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
