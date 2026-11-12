import { handler, jsonOk } from '@/lib/api';
import { get } from '@/lib/db';
import { readEmailConfig, deliverabilityAdvice, emailSecretStatus } from '@/lib/email/config';
import { listEmailMessages } from '@/lib/email/sender';
import { TEMPLATE_META } from '@/lib/email/templates';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req, _ctx, auth) => {
  const config = readEmailConfig(auth.workspaceId);
  const suppressions = Number(
    get<{ c: number }>('SELECT COUNT(*) AS c FROM email_suppressions')?.c ?? 0
  );
  const sent = Number(
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM email_messages WHERE user_id = ? AND status = 'sent'
         AND (workspace_id = ? OR (workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))`,
      auth.user.id,
      auth.workspaceId,
      auth.workspaceId,
      auth.user.id
    )?.c ?? 0
  );
  return jsonOk({
    config: {
      configured: config.configured,
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      hasPassword: config.hasPassword,
      fromAddress: config.fromAddress,
      fromName: config.fromName,
      replyTo: config.replyTo,
      postalAddress: config.postalAddress,
      unsubscribeUrl: config.unsubscribeUrl,
      missing: config.missing,
    },
    secrets: emailSecretStatus(),
    advice: deliverabilityAdvice(config),
    messages: listEmailMessages(auth.user.id, auth.workspaceId),
    suppressions,
    sentCount: sent,
    templates: TEMPLATE_META,
  });
});
