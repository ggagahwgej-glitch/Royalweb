import { handler, jsonOk } from '@/lib/api';
import { all } from '@/lib/db';
import { jobOut } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

const STATUS_ALIASES: Record<string, string[]> = {
  scheduled: ['scheduled', 'waiting_approval', 'processing'],
  published: ['published'],
  failed: ['failed', 'connection_expired', 'cancelled'],
  manual: ['manual_required'],
  all: [],
};

export const GET = handler(async (req, _ctx, auth) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'all';
  const campaignId = url.searchParams.get('campaignId');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 300);
  const statuses = STATUS_ALIASES[status] ?? [];

  const where: string[] = [
    'c.user_id = ?',
    "(c.workspace_id = ? OR (c.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))",
  ];
  const params: unknown[] = [auth.user.id, auth.workspaceId, auth.workspaceId, auth.user.id];
  if (statuses.length) {
    where.push(`j.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  if (status === 'failed') where.push("j.error_code IS NOT NULL OR j.status = 'failed'");
  if (campaignId) {
    where.push('j.campaign_id = ?');
    params.push(campaignId);
  }

  const rows = all(
    `SELECT j.*, c.name AS campaign_name, p.name AS platform_name, p.automation, a.account_name
       FROM publishing_jobs j
       JOIN campaigns c ON c.id = j.campaign_id
       JOIN platforms p ON p.id = j.platform_id
       LEFT JOIN connected_accounts a ON a.id = j.account_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(j.scheduled_at, j.created_at) DESC LIMIT ?`,
    ...params,
    limit
  );
  return jsonOk({ jobs: rows.map(jobOut) });
});
