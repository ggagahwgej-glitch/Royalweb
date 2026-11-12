import { z } from 'zod';
import { handler, jsonOk, parseBody, audit, ApiError } from '@/lib/api';
import { suppressEmail, isValidEmail } from '@/lib/email/sender';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().max(320),
  reason: z.string().trim().max(200).optional(),
});

/** Honour an opt-out. Permanent, global, and visible in the history. */
export const POST = handler(async (req, _ctx, auth) => {
  const body = await parseBody(req, schema);
  if (!isValidEmail(body.email)) throw new ApiError(400, 'Invalid email address', 'bad_email');
  suppressEmail(body.email, body.reason ?? 'operator added');
  await audit('email.suppressed', 'email_suppression', body.email, auth.user.id, { reason: body.reason });
  return jsonOk({ suppressed: body.email.trim().toLowerCase() });
});
