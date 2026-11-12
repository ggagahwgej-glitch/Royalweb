import 'server-only';
import { NextRequest } from 'next/server';
import { get } from '@/lib/db';
import { getSecret } from '@/lib/secrets';
import { basicAuth } from '@/lib/platforms/http';

/**
 * Generic OAuth 2.0 / PKCE engine. Client IDs and secrets live in the
 * environment or in encrypted application secrets — never in the frontend.
 */

export type OAuthProviderId = 'google' | 'pinterest' | 'linkedin' | 'x' | 'slack' | 'tumblr';

interface ProviderConfig {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  pkce: boolean;
  clientAuth: 'basic' | 'body';
  extraAuthorizeParams?: Record<string, string>;
  clientIdSecret: string;
  clientSecretSecret: string;
  /** Map the token response to adapter credentials. */
  mapToken: (data: Record<string, unknown>) => Record<string, string>;
}

export const OAUTH_PROVIDERS: Record<OAuthProviderId, ProviderConfig> = {
  google: {
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile'],
    pkce: true,
    clientAuth: 'body',
    extraAuthorizeParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    clientIdSecret: 'oauth.google.clientId',
    clientSecretSecret: 'oauth.google.clientSecret',
    mapToken: (data) => ({
      accessToken: String(data.access_token ?? ''),
      refreshToken: String(data.refresh_token ?? ''),
    }),
  },
  pinterest: {
    label: 'Pinterest',
    authorizeUrl: 'https://www.pinterest.com/oauth/',
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    scopes: ['pins:write', 'boards:read', 'user_accounts:read'],
    pkce: false,
    clientAuth: 'basic',
    clientIdSecret: 'oauth.pinterest.clientId',
    clientSecretSecret: 'oauth.pinterest.clientSecret',
    mapToken: (data) => ({
      accessToken: String(data.access_token ?? ''),
      refreshToken: String(data.refresh_token ?? ''),
    }),
  },
  linkedin: {
    label: 'LinkedIn',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['openid', 'profile', 'w_member_social'],
    pkce: false,
    clientAuth: 'body',
    clientIdSecret: 'oauth.linkedin.clientId',
    clientSecretSecret: 'oauth.linkedin.clientSecret',
    mapToken: (data) => ({ accessToken: String(data.access_token ?? '') }),
  },
  x: {
    label: 'X (Twitter)',
    authorizeUrl: 'https://x.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'],
    pkce: true,
    clientAuth: 'basic',
    clientIdSecret: 'oauth.x.clientId',
    clientSecretSecret: 'oauth.x.clientSecret',
    mapToken: (data) => ({
      accessToken: String(data.access_token ?? ''),
      refreshToken: String(data.refresh_token ?? ''),
    }),
  },
  slack: {
    label: 'Slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'files:write', 'channels:read'],
    pkce: false,
    clientAuth: 'body',
    clientIdSecret: 'oauth.slack.clientId',
    clientSecretSecret: 'oauth.slack.clientSecret',
    mapToken: (data) => ({
      botToken: String(data.access_token ?? ''),
      channelId: '',
    }),
  },
  tumblr: {
    label: 'Tumblr',
    authorizeUrl: 'https://www.tumblr.com/oauth2/authorize',
    tokenUrl: 'https://api.tumblr.com/v2/oauth2/token',
    scopes: ['basic', 'write', 'offline_access'],
    pkce: false,
    clientAuth: 'basic',
    clientIdSecret: 'oauth.tumblr.clientId',
    clientSecretSecret: 'oauth.tumblr.clientSecret',
    mapToken: (data) => ({ accessToken: String(data.access_token ?? ''), refreshToken: String(data.refresh_token ?? '') }),
  },
};

const PLATFORM_TO_PROVIDER: Record<string, OAuthProviderId> = {
  blogger: 'google',
  youtube: 'google',
  googlebusiness: 'google',
  pinterest: 'pinterest',
  linkedin: 'linkedin',
  x: 'x',
  slack: 'slack',
  tumblr: 'tumblr',
};

export function providerForPlatform(platformId: string): OAuthProviderId | null {
  return PLATFORM_TO_PROVIDER[platformId] ?? null;
}

export function oauthConfigured(provider: OAuthProviderId): boolean {
  const config = OAUTH_PROVIDERS[provider];
  return Boolean(getSecret(config.clientIdSecret) && getSecret(config.clientSecretSecret));
}

export function resolveScopes(provider: OAuthProviderId, platformScopes?: string[]): string[] {
  if (provider === 'google') {
    // Merge platform-specific Google scopes with basic identity scopes.
    return [...new Set([...(platformScopes ?? []), 'openid', 'email', 'profile'])];
  }
  if (provider === 'slack' || provider === 'pinterest') return platformScopes?.length ? platformScopes : OAUTH_PROVIDERS[provider].scopes;
  return OAUTH_PROVIDERS[provider].scopes;
}

export function buildAuthorizeUrl(opts: {
  provider: OAuthProviderId;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
  scopes: string[];
}): string | null {
  const config = OAUTH_PROVIDERS[opts.provider];
  const clientId = getSecret(config.clientIdSecret);
  if (!clientId) return null;
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', opts.scopes.join(' '));
  url.searchParams.set('state', opts.state);
  if (config.pkce && opts.codeChallenge) {
    url.searchParams.set('code_challenge', opts.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [key, value] of Object.entries(config.extraAuthorizeParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function exchangeCode(opts: {
  provider: OAuthProviderId;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<
  | { ok: true; credentials: Record<string, string>; expiresIn?: number; refreshToken?: string; raw: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const config = OAUTH_PROVIDERS[opts.provider];
  const clientId = getSecret(config.clientIdSecret);
  const clientSecret = getSecret(config.clientSecretSecret);
  if (!clientId || !clientSecret) return { ok: false, error: `${config.label} OAuth client is not configured.` };

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
  if (config.clientAuth === 'body') {
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
  }
  if (config.pkce && opts.codeVerifier) body.set('code_verifier', opts.codeVerifier);
  if (opts.provider === 'x' && opts.codeVerifier) body.set('code_verifier', opts.codeVerifier);

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (config.clientAuth === 'basic') headers.authorization = basicAuth(clientId, clientSecret);

  const res = await fetch(config.tokenUrl, { method: 'POST', headers, body });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: `${config.label} returned an unreadable token response: ${text.slice(0, 200)}` };
  }
  if (!res.ok || data.error) {
    return {
      ok: false,
      error: `${config.label} token exchange failed: ${data.error_description || data.error || `HTTP ${res.status}`}`,
    };
  }
  const credentials = config.mapToken(data);
  if (!credentials.accessToken && !credentials.botToken) {
    return { ok: false, error: `${config.label} did not return an access token.` };
  }
  return {
    ok: true,
    credentials,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    raw: data,
  };
}

export function findPlatformForProvider(provider: OAuthProviderId, requested?: string): string | null {
  if (requested && PLATFORM_TO_PROVIDER[requested] === provider) return requested;
  const candidates = Object.entries(PLATFORM_TO_PROVIDER).filter(([, p]) => p === provider);
  return candidates[0]?.[0] ?? null;
}

export function isPendingState(state: string, userId: string) {
  return get<{ state: string }>(
    'SELECT state FROM oauth_states WHERE state = ? AND user_id = ? AND expires_at > ?',
    state,
    userId,
    new Date().toISOString()
  );
}

/** Redirect URI registered with the provider. PUBLIC_BASE_URL wins when set. */
export function oauthRedirectUri(req: NextRequest, provider: string): string {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');
  const origin = configured || new URL(req.url).origin;
  return `${origin}/api/oauth/${provider}/callback`;
}
