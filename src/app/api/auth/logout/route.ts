import { NextRequest } from 'next/server';
import { jsonError, jsonOk, handler } from '@/lib/api';
import { destroyCurrentSession } from '@/lib/auth';
import { assertSameOrigin } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await assertSameOrigin(req);
    await destroyCurrentSession();
    return jsonOk({ signedOut: true });
  } catch (err) {
    return jsonError(err);
  }
}

export const GET = handler(async () => {
  await destroyCurrentSession();
  return jsonOk({ signedOut: true });
});
