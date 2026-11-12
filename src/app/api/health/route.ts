import { NextRequest } from 'next/server';
import { jsonOk, jsonError } from '@/lib/api';
import { get } from '@/lib/db';
import { ensureBootstrap } from '@/lib/bootstrap';
import { ffmpegPath } from '@/lib/media/video';
import { runtimeReport } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

/**
 * Public health check — no secrets, no business data.
 *
 * It also reports how the deployment is put together: serverless or
 * disk-backed, persistent or ephemeral storage, and whether the scheduler is the
 * in-process worker or an external cron. A load balancer or uptime monitor can
 * hit this safely, and an operator can see at a glance why data would reset.
 */
export async function GET(req: NextRequest) {
  void req;
  try {
    ensureBootstrap();
    const dbOk = Boolean(get('SELECT 1 AS ok'));
    const platforms = get<{ c: number }>('SELECT COUNT(*) AS c FROM platforms');
    const runtime = runtimeReport();
    return jsonOk({
      status: dbOk ? 'ok' : 'degraded',
      database: dbOk ? 'ok' : 'unavailable',
      platforms: Number(platforms?.c || 0),
      videoRenderer: Boolean(await ffmpegPath()),
      runtime: {
        platform: runtime.platform,
        serverless: runtime.serverless,
        storage: runtime.storage,
        durable: runtime.storage === 'persistent',
        worker: runtime.worker,
        region: runtime.region,
        node: runtime.node,
        writable: runtime.writable,
      },
      warnings: runtime.warnings,
      time: new Date().toISOString(),
    });
  } catch (err) {
    return jsonError(err);
  }
}
