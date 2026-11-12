import { NextRequest } from 'next/server';
import { handler, jsonOk, audit, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { runMonitor } from '@/lib/monitor';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Run the supervisor now: heartbeat check, token expiry, scheduled snapshots,
 * feed polling and evergreen recycling.
 *
 * Cron-safe: a GET with `Authorization: Bearer <CRON_SECRET>` is accepted so a
 * serverless deployment can drive the supervisor without a session.
 */
async function run(source: string, userId: string | null) {
  const result = await runMonitor();
  await audit('monitor.run', 'system', 'monitor', userId ?? undefined, {
    source,
    workerAlive: result.workerAlive,
    alerts: result.alerts,
    recycled: result.recycled,
  });
  return result;
}

export const GET = handler(async (req: NextRequest, _ctx, auth) => {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && bearer === cronSecret) {
    return jsonOk({ result: await run('cron', null) });
  }
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  return jsonOk({ result: await run('manual', auth.user.id) });
});

/** Dashboard button / acceptance suite. */
export const POST = handler(async (_req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  enforceRateLimit(`monitor:${auth.user.id}`, 20, 300);
  return jsonOk({ result: await run('manual', auth.user.id) });
});
