import { z } from 'zod';
import { handler, jsonOk, parseBody, audit, ApiError } from '@/lib/api';
import { writeEmailIdentity } from '@/lib/email/warmup';
import { readEmailConfig, emailSecretStatus } from '@/lib/email/config';
import { verifyEmailConfig } from '@/lib/email/sender';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  host: z.string().trim().max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  user: z.string().trim().max(320).optional(),
  pass: z.string().max(500).optional(),
  fromAddress: z.string().trim().email().max(320).optional().or(z.literal('')),
  fromName: z.string().trim().max(120).optional(),
  replyTo: z.string().trim().email().max(320).optional().or(z.literal('')),
  postalAddress: z.string().trim().max(400).optional(),
  unsubscribeUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
});

export const POST = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'forbidden');
  const body = await parseBody(req, schema);

  // The sender identity belongs to the active workspace (agency mode), so each
  // client can send from their own domain.
  writeEmailIdentity(auth.workspaceId, {
    host: body.host,
    port: body.port,
    user: body.user,
    pass: body.pass,
    fromAddress: body.fromAddress,
    fromName: body.fromName,
    replyTo: body.replyTo,
    postalAddress: body.postalAddress,
    unsubscribeUrl: body.unsubscribeUrl,
  });

  const config = readEmailConfig(auth.workspaceId);
  let verification: { ok: boolean; message: string } | null = null;
  if (config.configured) {
    verification = await verifyEmailConfig(auth.workspaceId);
  }

  await audit('settings.email_updated', 'user_settings', auth.user.id, auth.user.id, {
    configured: config.configured,
    verified: Boolean(verification?.ok),
  });

  return jsonOk({
    config: { ...config, user: config.user ? config.user.replace(/^(.{2}).*(@.*)$/, '$1***$2') : '' },
    secrets: emailSecretStatus(),
    verification,
  });
});
