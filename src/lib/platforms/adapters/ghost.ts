import crypto from 'node:crypto';
import type { PlatformAdapter } from '../types';
import { classify, http, httpJson, publishedUrlOrNull, truncate } from '../http';

function adminRoot(creds: Record<string, string>) {
  return creds.adminApiUrl.replace(/\/+$/, '');
}

/** Ghost Admin API auth: HS256 JWT signed with the key secret (hex). */
function ghostJwt(apiKey: string): string {
  const [id, secret] = apiKey.split(':');
  if (!id || !secret) throw new Error('Admin API key must be in the form id:secret');
  const header = { alg: 'HS256', typ: 'JWT', kid: id };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 300, aud: '/admin/' };
  const enc = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signInput = `${enc(header)}.${enc(payload)}`;
  const signature = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(signInput).digest('base64url');
  return `${signInput}.${signature}`;
}

export const ghost: PlatformAdapter = {
  id: 'ghost',
  name: 'Ghost',
  group: 'A',
  automation: 'automatic',
  integration: 'Ghost Admin API',
  docsUrl: 'https://ghost.org/docs/admin-api/',
  notes:
    'Publishes articles and uploads images to your own Ghost publication using the Admin API. Supports self-hosted Ghost and Ghost(Pro).',
  connectInstructions:
    'Ghost Admin → Settings → Integrations → Add custom integration → copy the Admin API URL and Admin API Key. The key looks like id:secret.',
  permissionNotes: 'The Admin API key is scoped to your publication. Keep it server-side only — ROYALWEB stores it encrypted and never exposes it to the browser.',
  credentialFields: [
    { key: 'adminApiUrl', label: 'Admin API URL', type: 'url', required: true, placeholder: 'https://yourblog.com/ghost/api/admin/' },
    { key: 'adminApiKey', label: 'Admin API key', type: 'password', required: true, placeholder: 'id:secret' },
  ],
  capabilities: { text: true, image: true, video: false, article: true },
  async verify({ credentials }) {
    try {
      ghostJwt(credentials.adminApiKey);
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
    const res = await httpJson<{ site?: { title?: string; url?: string } }>(
      `${adminRoot(credentials)}/site/`,
      { headers: { authorization: `Ghost ${ghostJwt(credentials.adminApiKey)}` } }
    );
    if (!res.ok) {
      const c = classify(res, 'Ghost verification');
      return { ok: false, detail: `${c.message} — check the Admin API URL ends with /ghost/api/admin/.` };
    }
    return { ok: true, accountName: res.data?.site?.title ?? 'Ghost site', meta: { siteUrl: res.data?.site?.url } };
  },
  async publish({ account, content, media, log }) {
    const root = adminRoot(account.credentials);
    const token = ghostJwt(account.credentials.adminApiKey);
    const auth = { authorization: `Ghost ${token}` };
    let featureImage: string | undefined;

    const image = media.find((m) => m.kind === 'image');
    if (image) {
      log('media', `Uploading ${image.filename} to Ghost`);
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(image.buffer)], { type: image.mime }), image.filename);
      form.set('purpose', 'image');
      form.set('ref', `${Date.now()}`);
      const up = await http(`${root}/images/upload/`, { method: 'POST', headers: auth, body: form });
      if (up.ok) {
        const imgs = (up.data as { images?: { url?: string }[] })?.images;
        featureImage = imgs?.[0]?.url;
      } else {
        log('media', `Image upload failed (HTTP ${up.status}); publishing without a feature image.`);
      }
    }

    const html = [
      content.description
        .split(/\n{2,}/)
        .map((p) => `<p>${p.trim().replace(/\n/g, '<br />')}</p>`)
        .join('\n'),
      content.destinationUrl ? `<p><a href="${content.destinationUrl}">${content.cta || 'Learn more'}</a></p>` : '',
    ].join('\n');

    const res = await httpJson<{ posts?: { id?: string; url?: string }[]; errors?: { message?: string }[] }>(
      `${root}/posts/?source=html`,
      {
        method: 'POST',
        headers: auth,
        body: {
          posts: [
            {
              title: truncate(content.title || content.caption, 255),
              html,
              status: 'published',
              feature_image: featureImage,
              custom_excerpt: truncate(content.caption, 300),
              tags: content.hashtags.map((name) => ({ name })),
            },
          ],
        },
      }
    );
    if (!res.ok) {
      const c = classify(res, 'Ghost publish');
      return { ok: false, error: res.data?.errors?.[0]?.message ?? c.message, errorCode: c.code, retryable: c.retryable };
    }
    const post = res.data?.posts?.[0];
    return { ok: true, externalId: post?.id, url: publishedUrlOrNull(post?.url) };
  },
  contentHint:
    'Publication-quality blog post for the Ghost site: engaging title, 400-700 word article with subheadings, professional tone, closing CTA.',
  limits: { caption: 8000, title: 255, hashtags: 8 },
};
