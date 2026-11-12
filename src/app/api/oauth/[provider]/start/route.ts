import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getAdapter } from '@/lib/platforms';
import { buildAuthorizeUrl, oauthConfigured, providerForPlatform, resolveScopes, OAUTH_PROVIDERS, oauthRedirectUri, type OAuthProviderId } from '@/lib/oauth';
import { newId, nowIso, run } from '@/lib/db';
import { pkcePair } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'Sign in first' }, { status: 401 });

  const { provider: providerParam } = await ctx.params;
  const provider = providerParam as OAuthProviderId;
  if (!OAUTH_PROVIDERS[provider]) {
    return NextResponse.json({ ok: false, error: 'Unknown OAuth provider' }, { status: 404 });
  }
  const url = new URL(req.url);
  const requestedPlatform = url.searchParams.get('platform') ?? undefined;
  const platformId = findPlatform(requestedPlatform, provider);
  if (!platformId) {
    return NextResponse.json({ ok: false, error: 'This provider is not mapped to a platform' }, { status: 400 });
  }
  if (!oauthConfigured(provider)) {
    const config = OAUTH_PROVIDERS[provider];
    return NextResponse.json(
      {
        ok: false,
        error: `${config.label} OAuth is not configured. Add the client ID and secret in Settings → Integrations (${config.clientIdSecret}, ${config.clientSecretSecret}).`,
        code: 'oauth_not_configured',
      },
      { status: 400 }
    );
  }

  const adapter = getAdapter(platformId);
  const state = newId().replace(/-/g, '');
  const { verifier, challenge } = pkcePair();
  const redirectUri = oauthRedirectUri(req, provider);

  run(
    `INSERT INTO oauth_states (state, platform_id, user_id, code_verifier, redirect_to, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    state,
    platformId,
    session.user.id,
    verifier,
    '/dashboard/accounts',
    nowIso(),
    new Date(Date.now() + 10 * 60_000).toISOString()
  );

  const authUrl = buildAuthorizeUrl({
    provider,
    redirectUri,
    state,
    codeChallenge: OAUTH_PROVIDERS[provider].pkce ? challenge : undefined,
    scopes: resolveScopes(provider, adapter?.oauth?.scopes),
  });
  if (!authUrl) return NextResponse.json({ ok: false, error: 'Could not build the authorization URL' }, { status: 500 });
  return NextResponse.redirect(authUrl);
}

function findPlatform(requested: string | undefined, provider: OAuthProviderId) {
  if (requested && getAdapter(requested) && providerForPlatform(requested) === provider) return requested;
  const fallback: Record<string, string> = {
    google: 'blogger',
    pinterest: 'pinterest',
    linkedin: 'linkedin',
    x: 'x',
    slack: 'slack',
    tumblr: 'tumblr',
  };
  return fallback[provider] ?? null;
}
