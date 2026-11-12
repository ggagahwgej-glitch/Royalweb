import { z } from 'zod';
import { handler, jsonOk, parseBody, audit, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { createSnapshot, deleteSnapshot, listSnapshots, snapshotConfig, writeSnapshotConfig } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const GET = handler(async (_req, _ctx, auth) => {
  // Snapshot metadata describes the whole installation, so only an operator
  // account may enumerate it (the download endpoint enforces the same rule).
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  const config = snapshotConfig();
  return jsonOk({
    config,
    snapshots: listSnapshots(20),
    note:
      'Snapshots contain the whole database (campaigns, jobs, published history, analytics, opt-outs) encrypted with a passphrase-derived key. Restore offline: npm run db:restore -- <file>.',
  });
});

const postSchema = z.object({
  action: z.enum(['create', 'config']).default('create'),
  passphrase: z.string().min(12).max(200).optional(),
  schedule: z.enum(['off', 'daily', 'weekly']).optional(),
  retention: z.number().int().min(1).max(90).optional(),
});

export const POST = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  enforceRateLimit(`snapshots:${auth.user.id}`, 12, 3600);
  const body = await parseBody(req, postSchema);

  if (body.action === 'config') {
    try {
      const config = writeSnapshotConfig({
        passphrase: body.passphrase,
        schedule: body.schedule,
        retention: body.retention,
        userId: auth.user.id,
      });
      await audit('snapshot.configured', 'system', 'snapshots', auth.user.id, {
        schedule: config.schedule,
        retention: config.retention,
      });
      return jsonOk({ config });
    } catch (err) {
      throw new ApiError(400, (err as Error).message, 'config_error');
    }
  }

  const result = createSnapshot({ trigger: 'manual', passphrase: body.passphrase });
  if (!result.ok) throw new ApiError(400, result.error ?? 'Snapshot failed', 'snapshot_failed');
  await audit('snapshot.created', 'system', result.fileName ?? 'snapshot', auth.user.id, {
    bytes: result.bytes,
    tables: result.tables,
  });
  return jsonOk({ result, snapshots: listSnapshots(20) });
});

const deleteSchema = z.object({ id: z.string().uuid() });

export const DELETE = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  const { id } = await parseBody(req, deleteSchema);
  if (!deleteSnapshot(id)) throw new ApiError(404, 'Snapshot not found', 'not_found');
  await audit('snapshot.deleted', 'system', id, auth.user.id);
  return jsonOk({ snapshots: listSnapshots(20) });
});
