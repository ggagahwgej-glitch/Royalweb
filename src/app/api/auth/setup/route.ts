import { NextRequest } from 'next/server';
import { assertSameOrigin, audit, jsonError, jsonOk, parseBody, ApiError } from '@/lib/api';
import { countUsers, createAdmin, createSession } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { setupSchema } from '@/lib/validation';
import { ensureBootstrap } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

/** First-run administrator creation. Disabled once any user exists. */
export async function POST(req: NextRequest) {
  try {
    ensureBootstrap();
    await assertSameOrigin(req);
    enforceRateLimit('setup', 5, 3600);
    if ((await countUsers()) > 0) {
      throw new ApiError(409, 'Setup has already been completed. Sign in instead.', 'already_setup');
    }
    const body = await parseBody(req, setupSchema);
    const user = await createAdmin({ ...body, name: body.name || 'ROYALWEB Admin' });
    await createSession(user.id);
    await audit('admin.created', 'user', user.id, user.id);
    return jsonOk({ user });
  } catch (err) {
    return jsonError(err);
  }
}
