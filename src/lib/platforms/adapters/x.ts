import type { PlatformAdapter } from '../types';
import { classify, http, httpJson, publishedUrlOrNull } from '../http';

const API = 'https://api.x.com';

export const x: PlatformAdapter = {
  id: 'x',
  name: 'X (Twitter)',
  group: 'B',
  automation: 'automatic',
  integration: 'X API v2 (OAuth 2.0 PKCE)',
  docsUrl: 'https://docs.x.com/x-api/posts/creation-of-a-post',
  notes:
    'X API access is not free: posting requires a paid API tier (Basic or higher). The adapter uses the official v2 create-post endpoint and v2 media upload, and reports rate-limit and plan errors exactly as X returns them.',
  connectInstructions:
    'Create a project/app in the X developer portal with OAuth 2.0 PKCE and read+write permission. Add the client ID in Settings → Integrations, then Connect with X. Attach a paid plan to the app before publishing.',
  permissionNotes: 'Scopes: tweet.read tweet.write users.read media.write offline.access. A free-tier app cannot post.',
  credentialFields: [
    { key: 'accessToken', label: 'User access token', type: 'password', required: false },
    { key: 'refreshToken', label: 'Refresh token', type: 'password', required: false },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  oauth: { provider: 'x', scopes: ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'] },
  async verify({ credentials }) {
    if (!credentials.accessToken) return { ok: false, detail: 'Use Connect with X to authorize the account.' };
    const me = await httpJson<{ data?: { id?: string; username?: string; name?: string } }>(
      `${API}/2/users/me`,
      { headers: { authorization: `Bearer ${credentials.accessToken}` } }
    );
    if (!me.ok) {
      const c = classify(me, 'X verification');
      return { ok: false, detail: c.message };
    }
    return {
      ok: true,
      accountName: `@${me.data?.data?.username}`,
      externalId: me.data?.data?.id,
      meta: { username: me.data?.data?.username, userId: me.data?.data?.id },
    };
  },
  async publish({ account, content, media, log }) {
    const token = account.credentials.accessToken;
    const auth = { authorization: `Bearer ${token}` };
    const mediaIds: string[] = [];

    const image = media.find((m) => m.kind === 'image');
    if (image) {
      log('media', `Uploading ${image.filename} to X`);
      const form = new FormData();
      form.set('media', new Blob([new Uint8Array(image.buffer)], { type: image.mime }), image.filename);
      form.set('media_category', 'tweet_image');
      form.set('media_type', image.mime);
      let up = await http(`${API}/2/media/upload`, { method: 'POST', headers: auth, body: form });
      if (!up.ok) {
        log('media', `v2 media upload failed (HTTP ${up.status}); trying the v1.1 upload endpoint`);
        const legacy = new FormData();
        legacy.set('media', new Blob([new Uint8Array(image.buffer)], { type: image.mime }), image.filename);
        legacy.set('media_category', 'tweet_image');
        up = await http('https://upload.twitter.com/1.1/media/upload.json', {
          method: 'POST',
          headers: auth,
          body: legacy,
        });
      }
      if (!up.ok) {
        const c = classify(up, 'X media upload');
        return {
          ok: false,
          error: `${c.message}${up.status === 403 ? ' — image upload requires media.write and a paid API tier.' : ''}`,
          errorCode: c.code,
          retryable: c.retryable,
        };
      }
      const mediaId =
        (up.data as { data?: { id?: string }; media_id_string?: string })?.data?.id ??
        (up.data as { media_id_string?: string })?.media_id_string;
      if (mediaId) mediaIds.push(String(mediaId));
    }

    let text = content.caption.trim();
    if (content.cta && !text.includes(content.cta)) text += `\n\n${content.cta}`;
    if (content.destinationUrl && !text.includes(content.destinationUrl)) text += `\n${content.destinationUrl}`;
    if (content.hashtags.length) {
      const tags = content.hashtags.slice(0, 3).map((h) => `#${h.replace(/^#/, '')}`).join(' ');
      if (!text.includes(tags)) text += ` ${tags}`;
    }
    if (text.length > 280) text = `${text.slice(0, 277).trimEnd()}…`;

    const res = await httpJson<{ data?: { id?: string; text?: string }; detail?: string; title?: string }>(
      `${API}/2/tweets`,
      {
        method: 'POST',
        headers: auth,
        body: mediaIds.length ? { text, media: { media_ids: mediaIds } } : { text },
      }
    );
    if (!res.ok) {
      const c = classify(res, 'X post');
      const detail = (res.data as { detail?: string })?.detail;
      return {
        ok: false,
        error: `${detail ?? c.message}${res.status === 403 ? ' — posting requires a paid X API tier.' : ''}`,
        errorCode: c.code,
        retryable: c.retryable,
      };
    }
    const id = res.data?.data?.id;
    const username = (account.meta.username as string | undefined) ?? '';
    return {
      ok: true,
      externalId: id,
      url: id ? publishedUrlOrNull(`https://x.com/${username || 'i'}/status/${id}`) : undefined,
    };
  },
  contentHint:
    'Short promotional X post under 280 characters including the link. Conversational and specific, one strong hook, max 2 hashtags.',
  limits: { caption: 280, hashtags: 2 },
};
