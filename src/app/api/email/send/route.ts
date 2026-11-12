import { z } from 'zod';
import { handler, jsonOk, parseBody, audit, ApiError } from '@/lib/api';
import { sendEmail, isValidEmail, isSuppressed } from '@/lib/email/sender';
import { readEmailConfig } from '@/lib/email/config';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const schema = z.object({
  to: z.string().trim().max(320),
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(20).max(8000),
  template: z.enum(['intro', 'follow_up', 'proposal', 'campaign_announcement', 'review_request', 'custom']).default('custom'),
  campaignId: z.string().uuid().optional(),
});

export const POST = handler(async (req, _ctx, auth) => {
  enforceRateLimit(`email-send:${auth.user.id}`, 20, 600);
  const body = await parseBody(req, schema);
  const config = readEmailConfig(auth.workspaceId);

  if (!config.configured) {
    throw new ApiError(
      400,
      `Email is not configured yet: ${config.missing.join(', ')}. Open Settings → Email.`,
      'email_not_configured'
    );
  }
  if (!isValidEmail(body.to)) throw new ApiError(400, 'Recipient address is not valid.', 'bad_recipient');
  if (isSuppressed(body.to).suppressed) {
    throw new ApiError(409, `${body.to} has opted out. Sending is blocked permanently.`, 'suppressed');
  }

  // Compliance guard: every commercial email must carry a way out. We accept an
  // unsubscribe URL, or an explicit reply-to-opt-out line in the body.
  const hasOptOut =
    Boolean(config.unsubscribeUrl) ||
    /(unsubscribe|reply\s+["“']?stop|opt[- ]out)/i.test(body.body);
  if (!hasOptOut) {
    throw new ApiError(
      400,
      'Every email needs an unsubscribe link or an explicit "reply stop" line. Add one before sending.',
      'missing_opt_out'
    );
  }

  const result = await sendEmail({
    userId: auth.user.id,
    workspaceId: auth.workspaceId,
    to: body.to,
    subject: body.subject,
    body: body.body,
    template: body.template,
    campaignId: body.campaignId ?? null,
  });

  // Warm-up and reply guards are real HTTP statuses, not silent no-ops.
  if (result.status === 'daily_limit') { audit('email.blocked', 'email_message', body.to, auth.user.id, { reason: 'daily_limit' }); throw new ApiError(429, result.message, 'daily_limit'); }
  if (result.status === 'reply_paused') { audit('email.blocked', 'email_message', body.to, auth.user.id, { reason: 'reply_paused' }); throw new ApiError(409, result.message, 'reply_paused'); }

  await audit('email.sent', 'email_message', body.to, auth.user.id, {
    status: result.status,
    template: body.template,
  });

  // Transport failures are returned as data (HTTP 200) so the UI can show the
  // exact SMTP reason instead of a generic request error. Nothing is ever
  // reported as "sent" unless the server accepted it.
  return jsonOk({ result });
});
