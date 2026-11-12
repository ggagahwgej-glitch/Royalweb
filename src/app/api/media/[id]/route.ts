import { inWorkspace } from '@/lib/scope';
import { handler, jsonOk, ApiError, parseBody, audit } from '@/lib/api';
import { get, run, nowIso } from '@/lib/db';
import { mediaPatchSchema } from '@/lib/validation';
import { deleteOriginal, deleteDerivatives } from '@/lib/media/storage';
import { ApiError as Err } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const row = get<Record<string, unknown>>(
    'SELECT * FROM media_assets WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    id,
    auth.user.id
  );
  if (!row || !inWorkspace('media_assets', id, auth)) throw new ApiError(404, 'Media not found', 'not_found');
  return jsonOk({ media: row });
});

export const PATCH = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, mediaPatchSchema);
  const row = get<{ id: string }>('SELECT id FROM media_assets WHERE id = ? AND user_id = ? AND deleted_at IS NULL', id, auth.user.id);
  if (!row || !inWorkspace('media_assets', id, auth)) throw new ApiError(404, 'Media not found', 'not_found');
  if (body.altText !== undefined) run('UPDATE media_assets SET alt_text = ? WHERE id = ?', body.altText, id);
  if (body.originalName !== undefined) run('UPDATE media_assets SET original_name = ? WHERE id = ?', body.originalName, id);
  if (body.campaignId !== undefined) run('UPDATE media_assets SET campaign_id = ? WHERE id = ?', body.campaignId, id);
  return jsonOk({ updated: true });
});

export const DELETE = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const force = new URL(req.url).searchParams.get('force') === '1';
  const row = get<{ id: string; filename: string; campaign_id: string | null }>(
    'SELECT id, filename, campaign_id FROM media_assets WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    id,
    auth.user.id
  );
  if (!row) throw new ApiError(404, 'Media not found', 'not_found');
  if (row.campaign_id) {
    const pendingJobs = get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM publishing_jobs
        WHERE campaign_id = ? AND status IN ('scheduled','processing','waiting_approval','manual_required')`,
      row.campaign_id
    );
    const active = get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM campaigns WHERE id = ? AND status IN ('scheduled','publishing','paused')`,
      row.campaign_id
    );
    const inUse = Number(pendingJobs?.c || 0) > 0 || Number(active?.c || 0) > 0;
    if (inUse && !force) {
      throw new ApiError(
        409,
        'This poster is used by a campaign with pending or scheduled posts. Cancel those jobs first, or confirm deletion to cancel them.',
        'media_in_active_campaign',
        { pendingJobs: Number(pendingJobs?.c || 0) }
      );
    }
    if (inUse && force) {
      // Publishing without the poster would produce a broken post, so the
      // dependent jobs are cancelled rather than silently attempted.
      run(
        `UPDATE publishing_jobs SET status = 'cancelled', error = 'Poster deleted by admin — job cancelled to avoid a post without media.',
           error_code = 'media_deleted', retryable = 0, updated_at = ?
         WHERE campaign_id = ? AND status IN ('scheduled','waiting_approval','manual_required')`,
        nowIso(),
        row.campaign_id
      );
      run(
        `UPDATE manual_tasks SET status = 'skipped', notes = 'Poster deleted by admin', updated_at = ?
          WHERE campaign_id = ? AND status = 'pending'`,
        nowIso(),
        row.campaign_id
      );
    }
  }
  run('UPDATE media_assets SET deleted_at = ? WHERE id = ?', nowIso(), id);
  run('UPDATE campaigns SET updated_at = ? WHERE id = ?', nowIso(), row.campaign_id ?? '');
  if (force) {
    run('DELETE FROM media_derivatives WHERE media_id = ?', id);
    deleteDerivatives(id);
    deleteOriginal(row.filename);
  }
  await audit('media.deleted', 'media_asset', id, auth.user.id, { forced: force });
  void Err;
  return jsonOk({ deleted: true, purged: force });
});
