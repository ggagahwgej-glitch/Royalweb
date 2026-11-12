import crypto from 'node:crypto';
import type { PlatformAdapter } from '../types';
import { classify, errorMessage, http, httpJson } from '../http';

const REST = 'https://www.flickr.com/services/rest/';
const UPLOAD = 'https://up.flickr.com/services/upload/';

function oauthHeader(
  method: string,
  url: string,
  creds: Record<string, string>,
  extra: Record<string, string> = {}
): string {
  const params: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
    ...extra,
  };
  const enc = (s: string) =>
    encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join('&');
  const baseString = `${method.toUpperCase()}&${enc(url)}&${enc(sorted)}`;
  const signingKey = `${enc(creds.apiSecret)}&${enc(creds.accessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  const headerParams: Record<string, string> = { ...params, oauth_signature: signature };
  return `OAuth ${Object.keys(headerParams)
    .map((k) => `${enc(k)}="${enc(headerParams[k])}"`)
    .join(', ')}`;
}

export const flickr: PlatformAdapter = {
  id: 'flickr',
  name: 'Flickr',
  group: 'B',
  automation: 'automatic',
  integration: 'Flickr REST API (OAuth 1.0a)',
  docsUrl: 'https://www.flickr.com/services/api/upload.api.html',
  notes:
    'Uploads promotional images to your own Flickr photostream using the official signed API. Review Flickr’s terms for commercial promotion before high-volume use.',
  connectInstructions:
    'Create an app at flickr.com/services/apps/create, complete the OAuth 1.0a flow for your own account, then paste the API key, secret, access token and token secret here. Tokens are stored encrypted.',
  permissionNotes: 'Requires delete/write permissions on your own account. No posting to other users’ photostreams.',
  credentialFields: [
    { key: 'apiKey', label: 'API key', type: 'password', required: true },
    { key: 'apiSecret', label: 'API secret', type: 'password', required: true },
    { key: 'accessToken', label: 'Access token', type: 'password', required: true },
    { key: 'accessTokenSecret', label: 'Access token secret', type: 'password', required: true },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  async verify({ credentials }) {
    const extra = { method: 'flickr.test.login', format: 'json', nojsoncallback: '1' };
    const res = await httpJson(
      `${REST}?method=flickr.test.login&format=json&nojsoncallback=1&oauth_consumer_key=${encodeURIComponent(credentials.apiKey)}&oauth_token=${encodeURIComponent(credentials.accessToken)}`,
      { headers: { authorization: oauthHeader('GET', REST, credentials, {}) } }
    );
    if (!res.ok || (res.data as { stat?: string })?.stat === 'fail') {
      const apiError = (res.data as { message?: string })?.message;
      return { ok: false, detail: apiError ?? classify(res, 'Flickr verification').message };
    }
    const user = (res.data as { user?: { username?: { _content?: string }; id?: string } })?.user;
    return {
      ok: true,
      accountName: user?.username?._content ?? 'Flickr account',
      externalId: user?.id,
      meta: { extra },
    };
  },
  async publish({ account, content, media }) {
    const image = media.find((m) => m.kind === 'image');
    if (!image) return { ok: false, error: 'Flickr requires an image to upload.', errorCode: 'missing_image', retryable: false };
    const form = new FormData();
    form.set('photo', new Blob([new Uint8Array(image.buffer)], { type: image.mime }), image.filename);
    form.set('title', (content.title || content.caption).slice(0, 200));
    form.set('description', [content.description || content.caption, content.cta, content.destinationUrl].filter(Boolean).join('\n\n').slice(0, 2000));
    form.set('tags', content.hashtags.slice(0, 10).map((t) => t.replace(/^#/, '').replace(/\s+/g, '')).join(' '));
    form.set('is_public', '1');
    const res = await http(UPLOAD, {
      method: 'POST',
      headers: { authorization: oauthHeader('POST', UPLOAD, account.credentials) },
      body: form,
    });
    if (!res.ok) {
      const c = classify(res, 'Flickr upload');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const xml = typeof res.data === 'string' ? res.data : res.text;
    if (/stat="fail"/.test(xml)) {
      return { ok: false, error: `Flickr rejected the upload: ${errorMessage({ ...res, data: xml }) || xml.slice(0, 300)}`, errorCode: 'api_rejected', retryable: false };
    }
    const photoid = /<photoid>(\d+)<\/photoid>/.exec(xml)?.[1];
    return {
      ok: true,
      externalId: photoid,
      url: photoid ? `https://www.flickr.com/photo.gne?id=${photoid}` : undefined,
    };
  },
  contentHint:
    'Image title (max 100 chars) plus a descriptive 1-2 sentence caption and 5-8 keyword tags. Describe what the graphic shows for image search.',
  limits: { caption: 2000, title: 200, hashtags: 8 },
};
