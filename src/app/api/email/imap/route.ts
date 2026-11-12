import { z } from 'zod';
import { handler, jsonOk, parseBody, audit, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { listReplies, pollReplies } from '@/lib/email/imap';
import { readWarmup, writeEmailIdentity } from '@/lib/email/warmup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = handler(async (_req, _ctx, auth) => {
  const settings = readWarmup(auth.workspaceId);
  return jsonOk({
    imap: {
      enabled: settings.imapEnabled,
      host: settings.imapHost,
      port: settings.imapPort,
      user: settings.imapUser,
      hasPassword: settings.hasImapPassword,
      lastPollAt: settings.imapLastPollAt,
      lastError: settings.imapLastError,
    },
    replies: listReplies(auth.workspaceId, 20),
  });
});

const schema = z.object({
  action: z.enum(['configure', 'poll']),
  enabled: z.boolean().optional(),
  host: z.string().max(200).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().max(200).optional(),
  pass: z.string().max(400).optional(),
});

export const POST = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  const body = await parseBody(req, schema);

  if (body.action === 'configure') {
    writeEmailIdentity(auth.workspaceId, {
      imapEnabled: body.enabled,
      imapHost: body.host,
      imapPort: body.port,
      imapUser: body.user,
      imapPass: body.pass,
    });
    await audit('email.imap_configured', 'workspace', auth.workspaceId, auth.user.id, {
      host: body.host,
      enabled: body.enabled,
    });
    const settings = readWarmup(auth.workspaceId);
    return jsonOk({
      imap: {
        enabled: settings.imapEnabled,
        host: settings.imapHost,
        port: settings.imapPort,
        user: settings.imapUser,
        hasPassword: settings.hasImapPassword,
      },
    });
  }

  enforceRateLimit(`imap-poll:${auth.user.id}`, 10, 600);
  const result = await pollReplies(auth.workspaceId);
  await audit('email.imap_polled', 'workspace', auth.workspaceId, auth.user.id, {
    ok: result.ok,
    checked: result.checked,
    newReplies: result.newReplies,
    paused: result.pausedFollowups,
  });
  return jsonOk({ result, replies: listReplies(auth.workspaceId, 20) });
});
