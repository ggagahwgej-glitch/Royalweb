import type { PlatformAdapter } from '../types';
import { classify, http, httpJson, publishedUrlOrNull, truncate } from '../http';

const API = 'https://api.linkedin.com';
const VERSION = process.env.LINKEDIN_API_VERSION || '202411';

function headers(token: string) {
  return {
    authorization: `Bearer ${token}`,
    'linkedin-version': VERSION,
    'x-restli-protocol-version': '2.0.0',
  };
}

export const linkedin: PlatformAdapter = {
  id: 'linkedin',
  name: 'LinkedIn',
  group: 'B',
  automation: 'automatic',
  integration: 'LinkedIn REST API (OAuth 2.0)',
  docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api',
  notes:
    'Publishes to a personal profile or a company page. Company-page publishing only works when the authorized member has an admin role on that page — the adapter checks this before posting.',
  connectInstructions:
    'Create an app at developer.linkedin.com, request "Share on LinkedIn" (w_member_social) and, for company pages, the Community Management API. Add the client ID/secret in Settings, then Connect with LinkedIn.',
  permissionNotes:
    'Personal: w_member_social + openid profile. Company page: w_organization_social and an admin role on the page. Community Management API requires LinkedIn approval.',
  credentialFields: [
    { key: 'accessToken', label: 'Access token', type: 'password', required: false },
    { key: 'authorUrn', label: 'Author URN', type: 'text', required: false, placeholder: 'urn:li:person:xxxx or urn:li:organization:yyyy' },
    { key: 'refreshToken', label: 'Refresh token', type: 'password', required: false },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  oauth: { provider: 'linkedin', scopes: ['openid', 'profile', 'w_member_social'] },
  async verify({ credentials }) {
    if (!credentials.accessToken) return { ok: false, detail: 'Use Connect with LinkedIn to authorize the account.' };
    const me = await httpJson<{ sub?: string; name?: string; given_name?: string }>(`${API}/v2/userinfo`, {
      headers: { authorization: `Bearer ${credentials.accessToken}` },
    });
    if (!me.ok) {
      const c = classify(me, 'LinkedIn verification');
      return { ok: false, detail: c.message };
    }
    const personUrn = credentials.authorUrn || `urn:li:person:${me.data?.sub}`;
    const orgs = await httpJson<{ elements?: { organization?: string; organizationTarget?: string; role?: string }[] }>(
      `${API}/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~(localizedName),organization,role))`,
      { headers: headers(credentials.accessToken) }
    );
    const organizations =
      orgs.data?.elements?.map((e) => ({
        urn: (e.organization as string) || (e.organizationTarget as string) || '',
        name: (e as unknown as { 'organization~'?: { localizedName?: string } })['organization~']?.localizedName ?? '',
      })) ?? [];
    return {
      ok: true,
      accountName: `${me.data?.name ?? me.data?.given_name ?? 'LinkedIn member'}${credentials.authorUrn?.startsWith('urn:li:organization') ? ' (company page)' : ''}`,
      externalId: personUrn,
      meta: { personUrn, organizations, memberName: me.data?.name },
    };
  },
  async publish({ account, content, media, business, log }) {
    const token = account.credentials.accessToken;
    const author = account.credentials.authorUrn || (account.meta.personUrn as string) || '';
    if (!author) return { ok: false, error: 'No LinkedIn author URN available. Reconnect the account.', errorCode: 'missing_author', retryable: false };
    const isOrg = author.startsWith('urn:li:organization');
    if (isOrg) {
      const orgs = (account.meta.organizations as { urn: string }[] | undefined) ?? [];
      if (!orgs.some((o) => o.urn === author)) {
        return {
          ok: false,
          error: `This account is not an administrator of ${author}, so company-page posting is not permitted. Connect the page admin account or post as a personal profile.`,
          errorCode: 'not_org_admin',
          retryable: false,
        };
      }
    }

    const commentary = [
      content.caption.trim(),
      content.cta ? `\n\n${content.cta}` : '',
      content.destinationUrl ? `\n${content.destinationUrl}` : '',
      content.hashtags.length ? `\n\n${content.hashtags.slice(0, 5).map((h) => `#${h.replace(/^#/, '')}`).join(' ')}` : '',
    ].join('');
    if (commentary.length > 3000) {
      return { ok: false, error: 'LinkedIn commentary exceeds the 3000 character limit.', errorCode: 'too_long', retryable: false };
    }

    let mediaUrn: string | undefined;
    const image = media.find((m) => m.kind === 'image');
    if (image) {
      log('media', 'Initializing LinkedIn image upload');
      const init = await httpJson<{ value?: { uploadUrl?: string; image?: string } }>(
        `${API}/rest/images?action=initializeUpload`,
        { method: 'POST', headers: headers(token), body: { initializeUploadRequest: { owner: author } } }
      );
      if (!init.ok) {
        const c = classify(init, 'LinkedIn image upload init');
        return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
      }
      const uploadUrl = init.data?.value?.uploadUrl;
      mediaUrn = init.data?.value?.image;
      if (uploadUrl && mediaUrn) {
        const put = await http(uploadUrl, {
          method: 'PUT',
          headers: { authorization: `Bearer ${token}`, 'content-type': image.mime },
          body: new Uint8Array(image.buffer),
        });
        if (!put.ok) {
          const c = classify(put, 'LinkedIn image upload');
          log('media', c.message);
          mediaUrn = undefined;
        }
      }
    }

    const body: Record<string, unknown> = {
      author,
      commentary,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (mediaUrn) body.content = { media: { id: mediaUrn, altText: content.altText || content.title } };

    log('publish', `Creating LinkedIn post as ${isOrg ? 'company page' : 'member'}`);
    const res = await http(`${API}/rest/posts`, {
      method: 'POST',
      headers: { ...headers(token), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const c = classify(res, 'LinkedIn publish');
      return {
        ok: false,
        error:
          res.status === 403
            ? `${c.message} — company page posting needs w_organization_social plus an admin role; personal posting needs w_member_social.`
            : c.message,
        errorCode: c.code,
        retryable: c.retryable,
      };
    }
    const postUrn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || '';
    return {
      ok: true,
      externalId: postUrn || undefined,
      url: postUrn ? publishedUrlOrNull(`https://www.linkedin.com/feed/update/${postUrn}`) : undefined,
      meta: { author, mediaUrn },
    };
  },
  contentHint:
    'Professional, business-focused LinkedIn caption (600-900 characters). Lead with a real insight about websites for local businesses, short paragraphs, one clear CTA, max 5 hashtags. No emoji spam.',
  limits: { caption: 3000, hashtags: 5 },
};
