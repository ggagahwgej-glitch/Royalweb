/**
 * One implementation of "connect an account", shared by the single-account route
 * and the bulk paste grid. Verification, encryption and the upsert rules must be
 * identical in both, otherwise the wizard could save something the modal refuses.
 */
import { get, newId, nowIso, run } from '@/lib/db';
import { getAdapter } from '@/lib/platforms';
import { encryptJson } from '@/lib/crypto';
import { accountOut } from '@/lib/serialize';
import { audit } from '@/lib/api';

export interface ConnectInput {
  userId: string;
  workspaceId: string | null;
  platformId: string;
  accountName?: string | null;
  credentials: Record<string, string>;
  /** Where the credentials came from — recorded in the audit trail. */
  via?: 'single' | 'bulk';
}

export interface ConnectResult {
  ok: boolean;
  /** Machine-readable reason when ok=false. */
  code?: 'unknown_platform' | 'missing_credentials' | 'verification_failed';
  detail?: string;
  missing?: string[];
  platformId: string;
  account?: ReturnType<typeof accountOut>;
  verification?: { ok: boolean; detail?: string } | null;
}

export function missingFields(platformId: string, credentials: Record<string, string>): string[] {
  const adapter = getAdapter(platformId);
  if (!adapter) return [];
  return adapter.credentialFields
    .filter((f) => f.required && !credentials[f.key]?.trim())
    .map((f) => f.label);
}

export async function connectAccount(input: ConnectInput): Promise<ConnectResult> {
  const adapter = getAdapter(input.platformId);
  if (!adapter) {
    return { ok: false, code: 'unknown_platform', detail: 'Unknown platform', platformId: input.platformId };
  }

  const credentialsInput: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.credentials ?? {})) {
    if (typeof v === 'string' && v.trim()) credentialsInput[k] = v.trim();
  }

  const missing = adapter.credentialFields
    .filter((f) => f.required && !credentialsInput[f.key])
    .map((f) => f.label);
  if (missing.length) {
    return {
      ok: false,
      code: 'missing_credentials',
      detail: `Missing required credentials: ${missing.join(', ')}`,
      missing,
      platformId: input.platformId,
    };
  }

  const verification = await adapter.verify({ credentials: credentialsInput, meta: {} });
  if (!verification.ok) {
    return {
      ok: false,
      code: 'verification_failed',
      detail: verification.detail || 'The platform rejected these credentials.',
      platformId: input.platformId,
      verification: { ok: false, detail: verification.detail },
    };
  }

  const accountName = verification.accountName || input.accountName?.trim() || adapter.name;
  const existing = get<{ id: string }>(
    'SELECT id FROM connected_accounts WHERE platform_id = ? AND account_name = ?',
    input.platformId,
    accountName
  );
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
       last_error = NULL, meta_json = excluded.meta_json, updated_at = excluded.updated_at,
       workspace_id = excluded.workspace_id, user_id = excluded.user_id`,
    id,
    input.platformId,
    input.userId,
    input.workspaceId,
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
    input.platformId
  );
  await audit('account.connected', 'connected_account', id, input.userId, {
    platform: input.platformId,
    via: input.via ?? 'single',
  });

  const row = get<Record<string, unknown>>(
    `SELECT a.*, p.name AS platform_name, p.automation FROM connected_accounts a
       JOIN platforms p ON p.id = a.platform_id WHERE a.id = ?`,
    id
  );

  return {
    ok: true,
    platformId: input.platformId,
    account: accountOut(row!),
    verification: { ok: true, detail: verification.detail },
  };
}
