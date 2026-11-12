import { handler, jsonOk, ApiError, audit } from '@/lib/api';
import { get, nowIso, run } from '@/lib/db';
import { getAdapter } from '@/lib/platforms';
import { decryptJson, encryptJson } from '@/lib/crypto';
import { accountOut } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export const POST = handler(async (_req, ctx, auth) => {
  const { id } = await ctx.params;
  const account = get<{
    id: string;
    platform_id: string;
    credentials_cipher: string;
  }>(
    `SELECT id, platform_id, credentials_cipher FROM connected_accounts
      WHERE id = ? AND user_id = ? AND status != 'revoked'`,
    id,
    auth.user.id
  );
  if (!account) throw new ApiError(404, 'Account not found', 'not_found');
  const adapter = getAdapter(account.platform_id);
  if (!adapter) throw new ApiError(400, 'Unknown platform', 'unknown_platform');

  let credentials: Record<string, string> = {};
  try {
    credentials = decryptJson<Record<string, string>>(account.credentials_cipher);
  } catch {
    throw new ApiError(400, 'Stored credentials could not be read. Reconnect the account.', 'credential_error');
  }

  const verification = await adapter.verify({ credentials, meta: {} });
  run(
    `UPDATE connected_accounts SET status = ?, last_verified_at = ?, last_error = ?, token_expires_at = ?,
       meta_json = ?, updated_at = ? WHERE id = ?`,
    verification.ok ? 'connected' : 'error',
    nowIso(),
    verification.ok ? null : verification.detail ?? 'Verification failed',
    verification.expiresAt ?? null,
    JSON.stringify(verification.meta ?? {}),
    nowIso(),
    id
  );
  if (!verification.ok) {
    run(
      'UPDATE platforms SET last_error = ?, last_error_at = ?, credential_status = ? WHERE id = ?',
      verification.detail ?? 'Verification failed',
      nowIso(),
      'error',
      account.platform_id
    );
  } else {
    run('UPDATE platforms SET last_error = NULL, last_error_at = NULL, credential_status = ? WHERE id = ?', 'connected', account.platform_id);
  }
  await audit('account.verified', 'connected_account', id, auth.user.id, { ok: verification.ok });

  const row = get<Record<string, unknown>>(
    `SELECT a.*, p.name AS platform_name, p.automation FROM connected_accounts a
       JOIN platforms p ON p.id = a.platform_id WHERE a.id = ?`,
    id
  );
  return jsonOk({
    ok: verification.ok,
    detail: verification.detail ?? null,
    account: accountOut(row!),
  });
});
