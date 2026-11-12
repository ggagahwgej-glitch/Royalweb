import { handler, jsonOk, audit, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { runMonitor } from '@/lib/monitor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Run the supervisor now. The background timer does this every minute; this
 * endpoint exists so an operator (and the acceptance suite) can trigger the same
 * real checks on demand instead of waiting.
 */
export const POST = handler(async (_req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  enforceRateLimit(`monitor:${auth.user.id}`, 20, 300);
  const result = await runMonitor();
  await audit('monitor.run', 'system', 'monitor', auth.user.id, {
    workerAlive: result.workerAlive,
    alerts: result.alerts,
    recycled: result.recycled,
  });
  return jsonOk({ result });
});
