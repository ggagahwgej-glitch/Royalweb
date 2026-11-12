import { handler, jsonOk, parseBody, ApiError, audit } from '@/lib/api';
import { get, nowIso, run } from '@/lib/db';
import { getAdapter } from '@/lib/platforms';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ enabled: z.boolean() });

export const PATCH = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const adapter = getAdapter(id);
  if (!adapter) throw new ApiError(404, 'Unknown platform', 'not_found');
  const { enabled } = await parseBody(req, schema);
  const row = get<{ id: string }>('SELECT id FROM platforms WHERE id = ?', id);
  if (!row) throw new ApiError(404, 'Platform not registered', 'not_found');

  run('UPDATE platforms SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id);
  if (!enabled) {
    run(
      `UPDATE publishing_jobs SET status = 'cancelled', error = 'Platform disabled by admin', updated_at = ?
        WHERE platform_id = ? AND status = 'scheduled'`,
      nowIso(),
      id
    );
  }
  await audit(enabled ? 'platform.enabled' : 'platform.disabled', 'platform', id, auth.user.id);
  return jsonOk({ platform: id, enabled });
});
