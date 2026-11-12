import type { PlatformAdapter } from '../types';
import { classify, http, httpJson } from '../http';

function base(creds: Record<string, string>) {
  return creds.instanceUrl.replace(/\/+$/, '');
}

export const mastodon: PlatformAdapter = {
  id: 'mastodon',
  name: 'Mastodon',
  group: 'A',
  automation: 'automatic',
  integration: 'Mastodon REST API (v1/v2)',
  docsUrl: 'https://docs.joinmastodon.org/methods/statuses/',
  notes:
    'Works with any Mastodon instance. Character limits and media rules are set by your instance; the adapter caps posts at 500 characters and uploads up to 4 images.',
  connectInstructions:
    'On your instance: Preferences → Development → New Application → enable write:statuses and write:media → copy the access token. Enter the instance URL (e.g. https://mastodon.social) and the token.',
  permissionNotes: 'Requires write:statuses and write:media scopes. The token acts as your account.',
  credentialFields: [
    { key: 'instanceUrl', label: 'Instance URL', type: 'url', required: true, placeholder: 'https://mastodon.social' },
    { key: 'accessToken', label: 'Access token', type: 'password', required: true },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  async verify({ credentials }) {
    if (!/^https:\/\//.test(credentials.instanceUrl || '')) {
      return { ok: false, detail: 'Instance URL must start with https://' };
    }
    const res = await httpJson<{ username?: string; display_name?: string; acct?: string; id?: string }>(
      `${base(credentials)}/api/v1/accounts/verify_credentials`,
      { headers: { authorization: `Bearer ${credentials.accessToken}` } }
    );
    if (!res.ok) {
      const c = classify(res, 'Mastodon verification');
      return { ok: false, detail: c.message };
    }
    const acct = res.data;
    return {
      ok: true,
      accountName: `@${acct?.acct ?? acct?.username}@${new URL(base(credentials)).host}`,
      externalId: acct?.id,
      meta: { instance: new URL(base(credentials)).host },
    };
  },
  async publish({ account, content, media, business, log }) {
    const root = base(account.credentials);
    const auth = { authorization: `Bearer ${account.credentials.accessToken}` };
    const mediaIds: string[] = [];

    for (const item of media.filter((m) => m.kind === 'image').slice(0, 4)) {
      log('media', `Uploading ${item.filename}`);
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(item.buffer)], { type: item.mime }), item.filename);
      form.set('description', content.altText || item.altText || content.title);
      const res = await http(`${root}/api/v2/media`, { method: 'POST', headers: auth, body: form });
      if (!res.ok) {
        const c = classify(res, 'Mastodon media upload');
        return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
      }
      let mediaId = (res.data as { id?: string })?.id;
      let murl = (res.data as { url?: string | null })?.url;
      // 206 = media is still processing; poll briefly.
      let polls = 0;
      while (mediaId && !murl && polls < 6) {
        await new Promise((r) => setTimeout(r, 1200));
        const check = await httpJson<{ url?: string | null }>(`${root}/api/v1/media/${mediaId}`, { headers: auth });
        murl = (check.data as { url?: string | null })?.url ?? null;
        polls += 1;
      }
      if (mediaId) mediaIds.push(mediaId);
    }

    let status = content.caption.trim();
    if (content.cta && !status.includes(content.cta)) status += `\n\n${content.cta}`;
    if (content.destinationUrl && !status.includes(content.destinationUrl)) status += `\n${content.destinationUrl}`;
    if (content.hashtags.length) {
      status += `\n\n${content.hashtags.slice(0, 5).map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`;
    }
    if (status.length > 500) status = `${status.slice(0, 497).trimEnd()}…`;

    const res = await httpJson<{ id?: string; url?: string; uri?: string }>(`${root}/api/v1/statuses`, {
      method: 'POST',
      headers: auth,
      body: { status, media_ids: mediaIds.length ? mediaIds : undefined, visibility: 'public' },
    });
    if (!res.ok) {
      const c = classify(res, 'Mastodon post');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    return { ok: true, externalId: res.data?.id, url: res.data?.url };
  },
  contentHint:
    'Relevant, non-spammy Mastodon post (max 500 chars) written for a community timeline. Helpful tone, no hard sell, max 5 hashtags with CamelCase.',
  limits: { caption: 500, hashtags: 5 },
};
