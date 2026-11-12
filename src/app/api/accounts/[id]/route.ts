import { handler, jsonOk, ApiError, audit, parseBody } from '@/lib/api';
import { get, nowIso, run } from '@/lib/db';
import { getAdapter } from '@/lib/platforms';
import { decryptJson, encryptJson } from '@/lib/crypto';
import { accountOut } from '@/lib/serialize';
import { z } from 'zod';
import { inWorkspace } from '@/lib/scope';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  destination: z.record(z.string().max(300)).optional(),
  accountName: z.string().trim().min(1).max(160).optional(),
});

function owned(id: string, auth: { user: { id: string }; workspaceId: string | null }) {
  return get<{
    id: string;
    platform_id: string;
    credentials_cipher: string;
    meta_json: string;
    account_name: string;
  }>(
    `SELECT a.id, a.platform_id, a.credentials_cipher, a.meta_json, a.account_name FROM connected_accounts a
      WHERE a.id = ? AND a.user_id = ? AND a.status != 'revoked'`,
    id,
    auth.user.id
  );
}

export const GET = handler(async (_req, ctx, auth) => {
  const { id } = await ctx.params;
  if (!owned(id, auth) || !inWorkspace('connected_accounts', id, auth))
    throw new ApiError(404, 'Account not found', 'not_found');
  const row = get<Record<string, unknown>>(
    `SELECT a.*, p.name AS platform_name, p.automation FROM connected_accounts a
       JOIN platforms p ON p.id = a.platform_id WHERE a.id = ?`,
    id
  );
  return jsonOk({ account: accountOut(row!) });
});

/** Update destination details (board, channel, blog, location…) without re-entering the token. */
export const PATCH = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const account = owned(id, auth);
  if (!account || !inWorkspace('connected_accounts', id, auth)) throw new ApiError(404, 'Account not found', 'not_found');
  const adapter = getAdapter(account.platform_id);
  if (!adapter) throw new ApiError(400, 'Unknown platform', 'unknown_platform');
  const body = await parseBody(req, patchSchema);

  const credentials = decryptJson<Record<string, string>>(account.credentials_cipher);
  if (body.destination) Object.assign(credentials, body.destination);

  let detail: string | undefined;
  let ok = false;
  const verification = await adapter.verify({ credentials, meta: {} });
  ok = verification.ok;
  detail = verification.detail;

  run(
    `UPDATE connected_accounts SET credentials_cipher = ?, account_name = ?, status = ?, last_verified_at = ?,
       last_error = ?, meta_json = ?, updated_at = ? WHERE id = ?`,
    encryptJson(credentials),
    verification.accountName || body.accountName || account.account_name,
    ok ? 'connected' : 'error',
    nowIso(),
    ok ? null : detail ?? 'Verification failed',
    JSON.stringify(verification.meta ?? {}),
    nowIso(),
    id
  );
  await audit('account.updated', 'connected_account', id, auth.user.id, { verified: ok });
  const row = get<Record<string, unknown>>(
    `SELECT a.*, p.name AS platform_name, p.automation FROM connected_accounts a
       JOIN platforms p ON p.id = a.platform_id WHERE a.id = ?`,
    id
  );
  return jsonOk({ account: accountOut(row!), verified: ok, detail });
});

/**
 * Disconnect: marks the connection revoked and cancels every pending job that
 * targets it, so nothing can be published to it afterwards.
 */
export const DELETE = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const account = owned(id, auth);
  if (!account || !inWorkspace('connected_accounts', id, auth)) throw new ApiError(404, 'Account not found', 'not_found');
  const purge = new URL(req.url).searchParams.get('purge') === '1';

  run(
    `UPDATE publishing_jobs SET status = 'cancelled', error = 'Account disconnected — job cancelled before publishing',
       updated_at = ? WHERE account_id = ? AND status IN ('scheduled','waiting_approval')`,
    nowIso(),
    id
  );
  if (purge) {
    run('DELETE FROM connected_accounts WHERE id = ?', id);
  } else {
    run(
      `UPDATE connected_accounts SET status = 'revoked', last_error = 'Disconnected by admin', updated_at = ?
        WHERE id = ?`,
      nowIso(),
      id
    );
  }
  const remaining = get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM connected_accounts WHERE platform_id = ? AND status = \'connected\'',
    account.platform_id
  );
  run(
    'UPDATE platforms SET credential_status = ? WHERE id = ?',
    Number(remaining?.c || 0) > 0 ? 'connected' : 'not_connected',
    account.platform_id
  );
  await audit('account.disconnected', 'connected_account', id, auth.user.id, {
    platform: account.platform_id,
    purge,
  });
  return jsonOk({ disconnected: true, cancelledJobs: true });
});
