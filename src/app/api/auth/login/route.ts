import { NextRequest } from 'next/server';
import { assertSameOrigin, audit, jsonError, jsonOk, parseBody, ApiError } from '@/lib/api';
import { loginWithPassword } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { loginSchema } from '@/lib/validation';
import { requestMeta } from '@/lib/auth';
import { ensureBootstrap } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    ensureBootstrap();
    await assertSameOrigin(req);
    const body = await parseBody(req, loginSchema);
    const { ip } = await requestMeta();
    enforceRateLimit(`login:ip:${ip}`, 12, 900);
    enforceRateLimit(`login:user:${body.email.toLowerCase()}`, 8, 900);

    const result = await loginWithPassword(body.email, body.password);
    if (!result.ok) {
      await audit('login.failed', 'user', body.email.toLowerCase());
      if (result.reason === 'locked') {
        throw new ApiError(
          429,
          `Too many failed attempts. Try again in ${Math.ceil((result.retryAfterSeconds ?? 900) / 60)} minutes.`,
          'locked'
        );
      }
      throw new ApiError(401, 'Invalid email or password.', 'invalid_credentials');
    }
    await audit('login.success', 'user', result.user.id, result.user.id);
    return jsonOk({ user: result.user });
  } catch (err) {
    return jsonError(err);
  }
}
