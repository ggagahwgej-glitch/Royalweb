import type { PlatformAdapter } from '../types';
import { classify, httpJson, publishedUrlOrNull, truncate } from '../http';

const API = 'https://www.googleapis.com/blogger/v3';

export const blogger: PlatformAdapter = {
  id: 'blogger',
  name: 'Blogger',
  group: 'A',
  automation: 'automatic',
  integration: 'Google Blogger API v3 (OAuth 2.0)',
  docsUrl: 'https://developers.google.com/blogger/docs/3.0/reference/posts/insert',
  notes:
    'Publishes posts via the official Blogger API. The Blogger API cannot host image files itself — an image is embedded only when PUBLIC_BASE_URL is configured so the poster has a public URL.',
  connectInstructions:
    'Connect with Google OAuth (scope blogger). After connecting, the adapter lists your blogs and uses the selected blog ID (or the first blog) as the destination.',
  permissionNotes: 'Requires the https://www.googleapis.com/auth/blogger scope and a blog on the authorized Google account.',
  credentialFields: [
    { key: 'accessToken', label: 'Google access token', type: 'password', required: false, help: 'Filled automatically by the OAuth connect flow. For manual entry, paste an OAuth access token with the blogger scope.' },
    { key: 'refreshToken', label: 'Google refresh token', type: 'password', required: false, help: 'Optional. Enables automatic token refresh.' },
    { key: 'blogId', label: 'Blog ID', type: 'text', required: false, placeholder: 'Leave blank to use your first blog' },
  ],
  capabilities: { text: true, image: true, video: false, article: true, imageViaUrl: true },
  oauth: { provider: 'google', scopes: ['https://www.googleapis.com/auth/blogger'] },
  async verify({ credentials }) {
    const token = credentials.accessToken;
    if (!token) return { ok: false, detail: 'An access token is required (use Connect with Google).' };
    const res = await httpJson(`${API}/users/self/blogs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const c = classify(res, 'Blogger verification');
      return { ok: false, detail: c.message };
    }
    const data = res.data as { items?: { id: string; name: string; url: string }[] };
    if (!data.items?.length) {
      return { ok: false, detail: 'No Blogger blog found on this Google account. Create a blog at blogger.com first.' };
    }
    const blog = credentials.blogId
      ? data.items.find((b) => b.id === credentials.blogId) ?? data.items[0]
      : data.items[0];
    return {
      ok: true,
      accountName: blog.name,
      externalId: blog.id,
      meta: { blogId: blog.id, blogUrl: blog.url, blogs: data.items.map((b) => ({ id: b.id, name: b.name })) },
    };
  },
  async publish({ account, content, media, business, log }) {
    let token = account.credentials.accessToken;
    const refresh = account.credentials.refreshToken;
    if (refresh) {
      const refreshed = await refreshGoogleToken(refresh);
      if (refreshed) token = refreshed;
    }
    const blogId = account.credentials.blogId || (account.meta.blogId as string | undefined);
    if (!blogId) return { ok: false, error: 'No Blogger blog ID on this account. Reconnect to select a blog.', errorCode: 'missing_blog', retryable: false };

    const image = media.find((m) => m.kind === 'image');
    let imageBlock = '';
    if (image) {
      if (image.publicUrl) {
        imageBlock = `<p><img src="${image.publicUrl}" alt="${escapeAttr(content.altText || content.title)}" style="max-width:100%;height:auto" /></p>`;
      } else {
        log('media', 'Blogger API cannot accept direct image uploads and no PUBLIC_BASE_URL is configured — publishing text only. Add the image manually in Blogger.');
      }
    }

    const html = [
      imageBlock,
      content.description
        .split(/\n{2,}/)
        .map((p) => `<p>${p.trim().replace(/\n/g, '<br />')}</p>`)
        .join('\n'),
      content.destinationUrl ? `<p><a href="${content.destinationUrl}">${content.cta || business.ctaPrimary || 'Visit website'}</a></p>` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const res = await httpJson(`${API}/blogs/${blogId}/posts/`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        kind: 'blogger#post',
        title: truncate(content.title || content.caption, 120),
        content: html,
        labels: content.hashtags.slice(0, 10),
      },
    });
    if (!res.ok) {
      const c = classify(res, 'Blogger publish');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const post = res.data as { id?: string; url?: string };
    return { ok: true, externalId: post?.id, url: publishedUrlOrNull(post?.url) };
  },
  contentHint:
    'Search-friendly blog article for a small website development business. Plain, helpful language. 300-600 words with a headline, short paragraphs and a closing CTA.',
  limits: { caption: 4000, title: 120, hashtags: 10 },
};

async function refreshGoogleToken(refreshToken: string): Promise<string | null> {
  const { getSecret } = await import('@/lib/secrets');
  const clientId = getSecret('oauth.google.clientId');
  const clientSecret = getSecret('oauth.google.clientSecret');
  if (!clientId || !clientSecret) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const raw = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  }).catch(() => null);
  if (!raw?.ok) return null;
  const data = (await raw.json().catch(() => null)) as { access_token?: string } | null;
  return data?.access_token ?? null;
}

function escapeAttr(value: string) {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
