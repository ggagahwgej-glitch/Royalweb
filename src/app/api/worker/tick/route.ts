import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { tick } from '@/lib/publishing/worker';
import { ensureBootstrap } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Cron / external worker entry point.
 *
 * Accepted credentials, in order:
 *   • `Authorization: Bearer <CRON_SECRET>` — what a Vercel cron sends
 *   • `x-worker-secret: <ROYALWEB_WORKER_SECRET>` — generic scheduler
 *   • a logged-in operator session (the dashboard "Run now" button)
 *
 * GET exists because cron platforms issue GET requests; POST is kept for the UI.
 */
async function run(req: NextRequest) {
  try {
    ensureBootstrap();
    const session = await getSession();
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const cronSecret = process.env.CRON_SECRET;
    const workerSecret = process.env.ROYALWEB_WORKER_SECRET;
    const provided = req.headers.get('x-worker-secret');
    const authorised =
      Boolean(session) ||
      (cronSecret && bearer === cronSecret) ||
      (workerSecret && provided === workerSecret);
    if (!authorised) {
      return jsonOk({ skipped: true, reason: 'unauthorised' }, { status: 401 });
    }
    const result = await tick(session ? 'manual' : 'cron');
    return jsonOk(result);
  } catch (err) {
    return jsonError(err);
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
