import { handler, jsonOk, parseBody, ApiError, audit } from '@/lib/api';
import { all, get, nowIso, run } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { z } from 'zod';
import { changePassword, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Security overview: real sessions, audit trail and credential health. */
export const GET = handler(async (_req, _ctx, auth) => {
  const sessions = all(
    `SELECT id, ip, user_agent, created_at, expires_at, last_seen_at, revoked_at,
            (id = ?) AS current
       FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
    auth.sessionId,
    auth.user.id,
    nowIso()
  );

  const auditLogs = all(
    'SELECT id, action, entity, entity_id, ip, meta_json, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 60',
    auth.user.id
  );

  const publishingLogs = all(
    `SELECT l.*, p.name AS platform_name FROM publishing_logs l
       JOIN campaigns c ON c.id = l.campaign_id
       LEFT JOIN platforms p ON p.id = l.platform_id
      WHERE c.user_id = ? ORDER BY l.created_at DESC LIMIT 40`,
    auth.user.id
  );

  const accounts = all(
    `SELECT a.id, a.account_name, a.status, a.token_expires_at, a.last_verified_at, a.last_error, p.name AS platform_name
       FROM connected_accounts a JOIN platforms p ON p.id = a.platform_id
      WHERE a.user_id = ? AND a.status != 'revoked' ORDER BY p.sort_order`,
    auth.user.id
  );

  const settings = getSettings(auth.user.id);
  const failedLogins = Number(
    get<{ c: number }>("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'login.failed' AND created_at > ?", new Date(Date.now() - 86400_000).toISOString())?.c ?? 0
  );

  return jsonOk({
    sessions,
    auditLogs,
    publishingLogs,
    accounts,
    failedLogins24h: failedLogins,
    posture: {
      encryption: process.env.ROYALWEB_ENCRYPTION_KEY ? 'environment key' : 'auto-generated key file',
      sessionTtlHours: 12,
      cookieHttpOnly: true,
      cookieSameSite: 'Lax',
      cookieSecure: process.env.NODE_ENV === 'production',
      globalPause: settings.globalPause,
      publicContactVisible: settings.publicContactVisible,
      tokensInFrontend: false,
      workerSecretConfigured: Boolean(process.env.ROYALWEB_WORKER_SECRET),
    },
  });
});

const actionSchema = z.union([
  z.object({ action: z.literal('revoke-others') }),
  z.object({ action: z.literal('revoke-all') }),
  z.object({ action: z.literal('change-password'), currentPassword: z.string().min(1), newPassword: z.string().min(10).max(200) }),
]);

export const POST = handler(async (req, _ctx, auth) => {
  const body = await parseBody(req, actionSchema);
  if (body.action === 'revoke-others' || body.action === 'revoke-all') {
    if (body.action === 'revoke-all') {
      run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), auth.user.id);
    } else {
      run(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
        nowIso(),
        auth.user.id,
        auth.sessionId
      );
    }
    const { ip } = await requestMeta();
    await audit(`security.${body.action}`, 'session', auth.user.id, auth.user.id, { ip });
    return jsonOk({ revoked: true });
  }

  const ok = await changePassword(auth.user.id, body.currentPassword, body.newPassword);
  if (!ok) throw new ApiError(400, 'The current password is incorrect.', 'bad_password');
  await audit('security.password_changed', 'user', auth.user.id, auth.user.id);
  return jsonOk({ changed: true, note: 'All sessions were signed out. Sign in again with the new password.' });
});
