import { NextRequest } from 'next/server';
import { jsonOk, jsonError } from '@/lib/api';
import { get } from '@/lib/db';
import { ensureBootstrap } from '@/lib/bootstrap';
import { ffmpegPath } from '@/lib/media/video';

export const dynamic = 'force-dynamic';

/** Public health check — no secrets, no business data. */
export async function GET(req: NextRequest) {
  void req;
  try {
    ensureBootstrap();
    const dbOk = Boolean(get('SELECT 1 AS ok'));
    const platforms = get<{ c: number }>('SELECT COUNT(*) AS c FROM platforms');
    return jsonOk({
      status: dbOk ? 'ok' : 'degraded',
      database: dbOk ? 'ok' : 'unavailable',
      platforms: Number(platforms?.c || 0),
      videoRenderer: Boolean(await ffmpegPath()),
      time: new Date().toISOString(),
    });
  } catch (err) {
    return jsonError(err);
  }
}
