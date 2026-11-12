import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { get, newId, nowIso, run } from '@/lib/db';
import { getAdapter } from '@/lib/platforms';
import { encryptJson } from '@/lib/crypto';
import { exchangeCode, oauthRedirectUri, type OAuthProviderId } from '@/lib/oauth';
import { audit } from '@/lib/api';
import { activeWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * OAuth callback. Credentials are exchanged server-side and stored encrypted;
 * the browser only receives a redirect back to the dashboard.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await ctx.params;
  const provider = providerParam as OAuthProviderId;
  const url = new URL(req.url);
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || url.origin;
  const fail = (message: string, platform?: string) =>
    NextResponse.redirect(
      `${base}/dashboard/accounts?oauth=error&provider=${provider}${platform ? `&platform=${platform}` : ''}&message=${encodeURIComponent(message)}`
    );

  const session = await getSession();
  if (!session) return fail('Your session expired before the authorization completed. Sign in and try again.');

  const error = url.searchParams.get('error');
  if (error) return fail(url.searchParams.get('error_description') || error);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail('The provider did not return an authorization code.');

  const pending = get<{ state: string; platform_id: string; code_verifier: string; expires_at: string; user_id: string }>(
    'SELECT * FROM oauth_states WHERE state = ? AND user_id = ?',
    state,
    session.user.id
  );
  if (!pending) return fail('Invalid OAuth state. Start the connection again.');
  run('DELETE FROM oauth_states WHERE state = ?', state);
  if (new Date(pending.expires_at).getTime() < Date.now()) return fail('The authorization took too long. Start again.');

  const exchange = await exchangeCode({
    provider,
    code,
    redirectUri: oauthRedirectUri(req, provider),
    codeVerifier: pending.code_verifier,
  });
  if (!exchange.ok) return fail(exchange.error, pending.platform_id);

  const adapter = getAdapter(pending.platform_id);
  if (!adapter) return fail('The selected platform is not registered.', pending.platform_id);

  const credentials = { ...exchange.credentials };
  const verification = await adapter.verify({ credentials, meta: {} });
  if (verification.accountName && !credentials.blogId && verification.meta?.blogId) {
    credentials.blogId = String(verification.meta.blogId);
  }
  if (verification.externalId && !credentials.boardId && adapter.id === 'pinterest') {
    credentials.boardId = verification.externalId;
  }
  if (adapter.id === 'googlebusiness' && verification.meta?.accountName) {
    credentials.accountId = String(verification.meta.accountName);
    credentials.locationId = verification.externalId ?? credentials.locationId;
  }

  const accountName = verification.accountName || `${adapter.name} account`;
  const accountId = newId();
  const expiresAt =
    exchange.expiresIn ? new Date(Date.now() + exchange.expiresIn * 1000).toISOString() : null;

  run(
    `INSERT INTO connected_accounts (id, platform_id, user_id, workspace_id, account_name, external_id, credentials_cipher,
       scopes, token_expires_at, status, last_verified_at, last_error, meta_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform_id, account_name) DO UPDATE SET credentials_cipher = excluded.credentials_cipher,
       workspace_id = excluded.workspace_id,
       external_id = excluded.external_id, scopes = excluded.scopes, status = excluded.status,
       token_expires_at = excluded.token_expires_at, last_verified_at = excluded.last_verified_at,
       last_error = excluded.last_error, meta_json = excluded.meta_json, updated_at = excluded.updated_at`,
    accountId,
    pending.platform_id,
    session.user.id,
    session.workspaceId ?? activeWorkspace(session.user.id).id,
    accountName,
    verification.externalId ?? null,
    encryptJson(credentials),
    adapter.oauth?.scopes.join(' ') ?? '',
    expiresAt,
    verification.ok ? 'connected' : 'error',
    nowIso(),
    verification.ok ? null : verification.detail ?? 'Connected, but the destination still needs to be selected.',
    JSON.stringify(verification.meta ?? {}),
    nowIso(),
    nowIso()
  );
  run(
    'UPDATE platforms SET credential_status = ?, last_error = ? WHERE id = ?',
    verification.ok ? 'connected' : 'error',
    verification.ok ? null : verification.detail ?? null,
    pending.platform_id
  );
  await audit('account.oauth_connected', 'connected_account', accountId, session.user.id, {
    platform: pending.platform_id,
    provider,
    verified: verification.ok,
  });

  return NextResponse.redirect(
    `${base}/dashboard/accounts?oauth=${verification.ok ? 'success' : 'incomplete'}&platform=${pending.platform_id}&message=${encodeURIComponent(
      verification.ok
        ? `${adapter.name} connected as ${accountName}.`
        : verification.detail ?? 'Authorized, but the destination still needs to be selected.'
    )}`
  );
}
