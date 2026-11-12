import { z } from 'zod';
import { handler, jsonOk, parseBody, audit, ApiError } from '@/lib/api';
import { readWarmup, warmupStatus, writeEmailIdentity } from '@/lib/email/warmup';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req, _ctx, auth) => {
  const status = warmupStatus(auth.workspaceId);
  return jsonOk({
    warmup: status,
    workspaceId: auth.workspaceId,
    note: status.note,
  });
});

const schema = z.object({
  host: z.string().max(200).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().max(200).optional(),
  pass: z.string().max(400).optional(),
  fromAddress: z.string().max(200).optional(),
  fromName: z.string().max(200).optional(),
  replyTo: z.string().max(200).optional(),
  postalAddress: z.string().max(300).optional(),
  unsubscribeUrl: z.string().max(500).optional(),
  rampEnabled: z.boolean().optional(),
  rampStart: z.number().int().min(1).max(500).optional(),
  rampIncrement: z.number().int().min(0).max(100).optional(),
  rampMax: z.number().int().min(1).max(2000).optional(),
});

/** Per-workspace sender identity + warm-up schedule. */
export const POST = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  const body = await parseBody(req, schema);
  writeEmailIdentity(auth.workspaceId, body);
  await audit('email.identity_updated', 'workspace', auth.workspaceId, auth.user.id, {
    fields: Object.keys(body).filter((k) => k !== 'pass'),
    ramp: { enabled: body.rampEnabled, start: body.rampStart, increment: body.rampIncrement, max: body.rampMax },
  });
  return jsonOk({ warmup: warmupStatus(auth.workspaceId) });
});
