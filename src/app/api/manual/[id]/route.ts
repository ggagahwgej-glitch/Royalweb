import { inWorkspace } from '@/lib/scope';
import { handler, jsonOk, ApiError, parseBody, audit } from '@/lib/api';
import { get, nowIso, run } from '@/lib/db';
import { z } from 'zod';
import { manualOut } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

const schema = z.object({
  status: z.enum(['pending', 'copied', 'published', 'skipped']).optional(),
  notes: z.string().max(2000).optional(),
});

export const PATCH = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const task = get<{ id: string; campaign_id: string; platform_id: string }>(
    `SELECT mt.id, mt.campaign_id, mt.platform_id FROM manual_tasks mt
       JOIN campaigns c ON c.id = mt.campaign_id WHERE mt.id = ? AND c.user_id = ?`,
    id,
    auth.user.id
  );
  if (!task || !inWorkspace('manual_tasks', id, auth)) throw new ApiError(404, 'Manual task not found', 'not_found');
  const body = await parseBody(req, schema);

  if (body.status) {
    run(
      'UPDATE manual_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
      body.status,
      body.status === 'published' ? nowIso() : null,
      nowIso(),
      id
    );
    if (body.status === 'published') {
      run(
        'UPDATE platforms SET last_activity_at = ? WHERE id = ?',
        nowIso(),
        task.platform_id
      );
    }
  }
  if (body.notes !== undefined) {
    run('UPDATE manual_tasks SET notes = ?, updated_at = ? WHERE id = ?', body.notes, nowIso(), id);
  }
  await audit('manual_task.updated', 'manual_task', id, auth.user.id, { status: body.status });

  const row = get<Record<string, unknown>>(
    `SELECT mt.*, c.name AS campaign_name, p.name AS platform_name FROM manual_tasks mt
       JOIN campaigns c ON c.id = mt.campaign_id JOIN platforms p ON p.id = mt.platform_id WHERE mt.id = ?`,
    id
  );
  return jsonOk({ task: manualOut(row!) });
});
