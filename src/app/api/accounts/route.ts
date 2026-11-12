import { handler, jsonOk, parseBody, ApiError, audit } from '@/lib/api';
import { all, get, newId, nowIso, run } from '@/lib/db';
import { getAdapter } from '@/lib/platforms';
import { accountSchema } from '@/lib/validation';
import { encryptJson } from '@/lib/crypto';
import { accountOut } from '@/lib/serialize';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req, _ctx, auth) => {
  const rows = all(
    `SELECT a.*, p.name AS platform_name, p.automation FROM connected_accounts a
       JOIN platforms p ON p.id = a.platform_id
      WHERE a.user_id = ? AND a.status != 'revoked'
        AND (a.workspace_id = ? OR (a.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))
      ORDER BY p.sort_order, a.created_at`,
    auth.user.id,
    auth.workspaceId,
    auth.workspaceId,
    auth.user.id
  );
  return jsonOk({ accounts: rows.map(accountOut) });
});

export const POST = handler(async (req, _ctx, auth) => {
  enforceRateLimit(`account-connect:${auth.user.id}`, 30, 600);
  const body = await parseBody(req, accountSchema);
  const adapter = getAdapter(body.platformId);
  if (!adapter) throw new ApiError(404, 'Unknown platform', 'unknown_platform');

  const credentialsInput: Record<string, string> = body.credentials ?? {};
  const missing = adapter.credentialFields
    .filter((f) => f.required && !credentialsInput[f.key]?.trim())
    .map((f) => f.label);
  if (missing.length) {
    throw new ApiError(400, `Missing required credentials: ${missing.join(', ')}`, 'missing_credentials', { missing });
  }

  const verification = await adapter.verify({ credentials: credentialsInput, meta: {} });
  if (!verification.ok) {
    throw new ApiError(400, verification.detail || 'The platform rejected these credentials.', 'verification_failed');
  }

  const existing = get<{ id: string }>(
    'SELECT id FROM connected_accounts WHERE platform_id = ? AND account_name = ?',
    body.platformId,
    verification.accountName || body.accountName
  );
  const accountName = verification.accountName || body.accountName;
  const credentials = { ...credentialsInput };
  if (verification.meta) {
    for (const [k, v] of Object.entries(verification.meta)) {
      if (typeof v === 'string' && !credentials[k]) credentials[k] = v;
    }
  }
  if (!credentials.blogId && verification.meta?.blogId) credentials.blogId = String(verification.meta.blogId);
  if (!credentials.boardId && verification.externalId) credentials.boardId = String(verification.externalId);

  const id = existing?.id ?? newId();
  run(
    `INSERT INTO connected_accounts (id, platform_id, user_id, workspace_id, account_name, external_id,
       credentials_cipher, scopes, token_expires_at, status, last_verified_at, meta_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?, ?, ?)
     ON CONFLICT(platform_id, account_name) DO UPDATE SET credentials_cipher = excluded.credentials_cipher,
       external_id = excluded.external_id, status = 'connected', last_verified_at = excluded.last_verified_at,
       last_error = NULL, meta_json = excluded.meta_json, updated_at = excluded.updated_at`,
    id,
    body.platformId,
    auth.user.id,
    auth.workspaceId,
    accountName,
    verification.externalId ?? null,
    encryptJson(credentials),
    verification.scopes ?? adapter.oauth?.scopes.join(' ') ?? '',
    verification.expiresAt ?? null,
    nowIso(),
    JSON.stringify(verification.meta ?? {}),
    nowIso(),
    nowIso()
  );
  run(
    'UPDATE platforms SET credential_status = ?, last_error = NULL, last_error_at = NULL WHERE id = ?',
    'connected',
    body.platformId
  );
  await audit('account.connected', 'connected_account', id, auth.user.id, { platform: body.platformId });

  const row = get<Record<string, unknown>>(
    `SELECT a.*, p.name AS platform_name, p.automation FROM connected_accounts a
       JOIN platforms p ON p.id = a.platform_id WHERE a.id = ?`,
    id
  );
  return jsonOk({ account: accountOut(row!), verification });
});

