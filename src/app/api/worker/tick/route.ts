import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { tick } from '@/lib/publishing/worker';
import { ensureBootstrap } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Cron / external worker entry point.
 * Accepts either an authenticated admin session or the shared worker secret.
 */
export async function POST(req: NextRequest) {
  try {
    ensureBootstrap();
    const secret = process.env.ROYALWEB_WORKER_SECRET;
    const provided = req.headers.get('x-worker-secret');
    const session = await getSession();
    const authorised = Boolean(session) || (secret && provided === secret);
    if (!authorised) {
      return jsonOk({ skipped: true, reason: 'unauthorised' }, { status: 401 });
    }
    const result = await tick(session ? 'manual' : 'cron');
    return jsonOk(result);
  } catch (err) {
    return jsonError(err);
  }
}
