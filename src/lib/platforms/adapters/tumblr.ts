import type { PlatformAdapter } from '../types';
import { classify, httpJson, publishedUrlOrNull, truncate } from '../http';

const API = 'https://api.tumblr.com/v2';

function blogId(creds: Record<string, string>) {
  return (creds.blogIdentifier || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

export const tumblr: PlatformAdapter = {
  id: 'tumblr',
  name: 'Tumblr',
  group: 'A',
  automation: 'automatic',
  integration: 'Tumblr API v2 (OAuth 2.0)',
  docsUrl: 'https://www.tumblr.com/docs/en/api/v2',
  notes:
    'Publishes an image post to your own Tumblr blog through the official API. Requires a registered Tumblr OAuth app.',
  connectInstructions:
    'Register an OAuth2 app at tumblr.com/oauth/apps, add the client ID and secret in Settings → Integrations, then use Connect with Tumblr and pick a blog.',
  permissionNotes: 'Requires the basic write scope on your own blog. Posting to blogs you do not own is not supported.',
  credentialFields: [
    { key: 'accessToken', label: 'OAuth access token', type: 'password', required: false },
    { key: 'refreshToken', label: 'Refresh token', type: 'password', required: false },
    { key: 'blogIdentifier', label: 'Blog identifier', type: 'text', required: true, placeholder: 'yourblog.tumblr.com' },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  oauth: { provider: 'tumblr', scopes: ['basic write offline_access'] },
  async verify({ credentials }) {
    if (!credentials.accessToken) return { ok: false, detail: 'Use Connect with Tumblr to authorize an account.' };
    const res = await httpJson<{ response?: { user?: { name?: string; blogs?: { name: string; url: string }[] } } }>(
      `${API}/user/info`,
      { headers: { authorization: `Bearer ${credentials.accessToken}` } }
    );
    if (!res.ok) {
      const c = classify(res, 'Tumblr verification');
      return { ok: false, detail: c.message };
    }
    const user = res.data?.response?.user;
    const blog = user?.blogs?.find((b) => b.name === blogId(credentials)) ?? user?.blogs?.[0];
    if (!blog) return { ok: false, detail: 'No Tumblr blog found for this account.' };
    return {
      ok: true,
      accountName: blog.name,
      externalId: blog.name,
      meta: { blogUrl: blog.url, blogs: user?.blogs?.map((b) => ({ name: b.name, url: b.url })) },
    };
  },
  async publish({ account, content, media, log }) {
    const blog = blogId(account.credentials) || (account.meta.blogUrl as string | undefined) || '';
    const auth = { authorization: `Bearer ${account.credentials.accessToken}` };
    const image = media.find((m) => m.kind === 'image');
    const tags = content.hashtags.slice(0, 20).join(',');

    // Neue Post Format (the currently supported format).
    if (image) {
      log('media', `Embedding ${image.filename} as a base64 NPF image block`);
      const blocks: unknown[] = [];
      if (content.title) blocks.push({ type: 'heading1', text: content.title });
      blocks.push({
        type: 'image',
        media: [{ type: image.mime, data: image.buffer.toString('base64'), width: image.width ?? undefined, height: image.height ?? undefined }],
        alt_text: content.altText || image.altText || content.title,
      });
      const body = [content.caption, content.description, content.cta, content.destinationUrl].filter(Boolean).join('\n\n');
      if (body) {
        blocks.push({
          type: 'text',
          text: content.destinationUrl
            ? `${body.replace(content.destinationUrl, '')}\n\n${content.destinationUrl}`
            : body,
        });
      }
      const res = await httpJson<{ response?: { id?: string; id_string?: string; display_text?: string } }>(
        `${API}/blog/${encodeURIComponent(blog)}/posts`,
        { method: 'POST', headers: auth, body: { content: blocks, tags, state: 'published' } }
      );
      if (res.ok) {
        const post = res.data?.response;
        const id = post?.id_string || post?.id;
        return {
          ok: true,
          externalId: id,
          url: id ? `https://${blog}/post/${id}` : undefined,
        };
      }
      log('publish', `NPF post failed (HTTP ${res.status}); retrying with the legacy photo format`);
    }

    // Legacy fallback: photo/text post.
    const legacyBody: Record<string, unknown> = {
      type: image ? 'photo' : 'text',
      state: 'published',
      tags,
    };
    if (image) {
      legacyBody.data = image.buffer.toString('base64');
      legacyBody.caption = [content.caption, content.cta, content.destinationUrl].filter(Boolean).join('\n\n');
    } else {
      legacyBody.title = content.title;
      legacyBody.body = [content.description || content.caption, content.cta, content.destinationUrl].filter(Boolean).join('\n\n');
    }
    const res = await httpJson<{ response?: { id?: string; id_string?: string } }>(
      `${API}/blog/${encodeURIComponent(blog)}/posts`,
      { method: 'POST', headers: auth, body: legacyBody }
    );
    if (!res.ok) {
      const c = classify(res, 'Tumblr post');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const id = res.data?.response?.id_string || res.data?.response?.id;
    return { ok: true, externalId: id, url: publishedUrlOrNull(id ? `https://${blog}/post/${id}` : undefined) };
  },
  contentHint:
    'Tumblr image post: a short, casual caption (1-3 sentences), a title, and 5-10 tags. Creative and friendly, not corporate.',
  limits: { caption: 1000, title: 100, hashtags: 10 },
};

export const _truncate = truncate;
