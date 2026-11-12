import type { PlatformAdapter } from '../types';
import { classify, httpJson, truncate } from '../http';

/**
 * Google Business Profile.
 * Access to these APIs requires Google approval; the adapter verifies the
 * connection and refuses to post to locations the account does not manage.
 * Local posts are served by the legacy v4 localPosts endpoint (still the only
 * endpoint that supports them).
 */
export const googlebusiness: PlatformAdapter = {
  id: 'googlebusiness',
  name: 'Google Business Profile',
  group: 'B',
  automation: 'approval',
  integration: 'Google Business Profile APIs (local posts)',
  docsUrl: 'https://developers.google.com/my-business/reference/rest',
  notes:
    'Requires Google approval for the Business Profile APIs, an eligible verified profile, and an image with a public URL. Only locations your Google account actually manages can be posted to.',
  connectInstructions:
    'Apply for Business Profile API access in Google Cloud (OAuth consent + access request form). Then Connect with Google and enter the account + location IDs returned by the API.',
  permissionNotes:
    'Scope https://www.googleapis.com/auth/business.manage. The OAuth account must be an owner/manager of the location.',
  credentialFields: [
    { key: 'accessToken', label: 'Google access token', type: 'password', required: false },
    { key: 'refreshToken', label: 'Refresh token', type: 'password', required: false },
    { key: 'accountId', label: 'Business account ID', type: 'text', required: true, placeholder: 'accounts/1234567890 or 1234567890' },
    { key: 'locationId', label: 'Location ID', type: 'text', required: true, placeholder: 'locations/9876543210 or 9876543210' },
  ],
  capabilities: { text: true, image: true, video: false, article: false, imageViaUrl: true },
  oauth: { provider: 'google', scopes: ['https://www.googleapis.com/auth/business.manage'] },
  async verify({ credentials }) {
    if (!credentials.accessToken) return { ok: false, detail: 'Use Connect with Google (business.manage scope).' };
    const auth = { authorization: `Bearer ${credentials.accessToken}` };
    const accounts = await httpJson<{ accounts?: { name: string; accountName?: string }[] }>(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      { headers: auth }
    );
    if (!accounts.ok) {
      const c = classify(accounts, 'Google Business verification');
      return {
        ok: false,
        detail: `${c.message} — Google Business Profile APIs require an approved project and a verified business.`,
      };
    }
    const list = accounts.data?.accounts ?? [];
    const account = credentials.accountId
      ? list.find((a) => a.name.endsWith(credentials.accountId.replace(/^accounts\//, '')))
      : list[0];
    if (!account) {
      return { ok: false, detail: 'That Google account manages no Business Profile accounts (or access is not approved).' };
    }
    const locs = await httpJson<{ locations?: { name: string; title?: string }[] }>(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`,
      { headers: auth }
    );
    const locations = locs.data?.locations ?? [];
    const location = credentials.locationId ? locations.find((l) => l.name.endsWith(credentials.locationId.replace(/^locations\//, ''))) : locations[0];
    if (!location) return { ok: false, detail: 'No manageable location found on this business account.' };
    return {
      ok: true,
      accountName: `${account.accountName ?? account.name} → ${location.title ?? location.name}`,
      externalId: location.name,
      meta: { accountName: account.name, locations },
    };
  },
  async publish({ account, content, media, log }) {
    const token = account.credentials.accessToken;
    const accountName = account.credentials.accountId.startsWith('accounts/')
      ? account.credentials.accountId
      : `accounts/${account.credentials.accountId}`;
    const locationName = account.credentials.locationId.startsWith('locations/')
      ? account.credentials.locationId
      : `locations/${account.credentials.locationId}`;
    const auth = { authorization: `Bearer ${token}` };
    const image = media.find((m) => m.kind === 'image');
    if (image && !image.publicUrl) {
      log('media', 'Google Business local posts need a publicly reachable image URL; publishing text only. Configure PUBLIC_BASE_URL to include the poster.');
    }
    const body: Record<string, unknown> = {
      languageCode: 'en',
      summary: truncate(content.caption || content.title, 1500),
      callToAction: content.destinationUrl
        ? { actionType: 'LEARN_MORE', url: content.destinationUrl }
        : { actionType: 'CALL' },
    };
    if (image?.publicUrl) body.media = [{ mediaFormat: 'PHOTO', sourceUrl: image.publicUrl }];

    const res = await httpJson<{ name?: string; searchUrl?: string }>(
      `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/localPosts`,
      { method: 'POST', headers: auth, body }
    );
    if (!res.ok) {
      const c = classify(res, 'Google Business local post');
      return {
        ok: false,
        error:
          res.status === 403
            ? `${c.message} — Business Profile API access must be approved by Google for this Cloud project.`
            : c.message,
        errorCode: c.code,
        retryable: c.retryable,
      };
    }
    return { ok: true, externalId: res.data?.name, url: res.data?.searchUrl };
  },
  contentHint:
    'Local business update for a Google Business Profile post: 150-300 characters, mention the service, the location/city, the offer, and a clear call to action. Plain text, no hashtags.',
  limits: { caption: 1500, hashtags: 0 },
};
