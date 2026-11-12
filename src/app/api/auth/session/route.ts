import { NextRequest } from 'next/server';
import { jsonOk, jsonError } from '@/lib/api';
import { getSession, countUsers } from '@/lib/auth';
import { ensureBootstrap } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  void req;
  try {
    ensureBootstrap();
    const session = await getSession();
    const users = await countUsers();
    return jsonOk({
      user: session?.user ?? null,
      needsSetup: users === 0,
      authenticated: Boolean(session),
    });
  } catch (err) {
    return jsonError(err);
  }
}
