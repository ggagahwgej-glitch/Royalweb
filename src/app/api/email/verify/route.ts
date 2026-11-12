import { handler, jsonOk, audit } from '@/lib/api';
import { verifyEmailConfig } from '@/lib/email/sender';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Performs a real SMTP handshake + login. This is the only "connected" signal. */
export const POST = handler(async (_req, _ctx, auth) => {
  enforceRateLimit(`email-verify:${auth.user.id}`, 10, 600);
  const result = await verifyEmailConfig();
  await audit('email.verified', 'system', 'smtp', auth.user.id, { ok: result.ok });
  return jsonOk(result);
});
