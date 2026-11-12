import type { PlatformAdapter } from '../types';
import { basicAuth, classify, http, httpJson, errorMessage, publishedUrlOrNull } from '../http';

function baseUrl(creds: Record<string, string>) {
  return creds.siteUrl.replace(/\/+$/, '');
}

function htmlFrom(text: string) {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.trim().replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

export const wordpress: PlatformAdapter = {
  id: 'wordpress',
  name: 'WordPress',
  group: 'A',
  automation: 'automatic',
  integration: 'WordPress REST API (Application Passwords)',
  docsUrl: 'https://developer.wordpress.org/rest-api/reference/posts/',
  notes:
    'Publishes to your own WordPress site via the official REST API using an Application Password. The site must be publicly reachable over HTTPS for the API to respond.',
  connectInstructions:
    'In WordPress: Users → Profile → Application Passwords → create a password named "Royalweb Autopilot". Enter your site URL, username, and the generated application password (not your login password).',
  permissionNotes:
    'Requires a user role with publish_posts (Editor or Administrator). Application Passwords require WordPress 5.6+ and HTTPS.',
  credentialFields: [
    { key: 'siteUrl', label: 'WordPress site URL', type: 'url', required: true, placeholder: 'https://example.com' },
    { key: 'username', label: 'WordPress username', type: 'text', required: true },
    {
      key: 'appPassword',
      label: 'Application Password',
      type: 'password',
      required: true,
      help: 'Generated in Users → Profile → Application Passwords. Stored encrypted server-side.',
    },
  ],
  capabilities: { text: true, image: true, video: false, article: true },
  async verify({ credentials }) {
    if (!credentials.siteUrl) return { ok: false, detail: 'Site URL is required' };
    const res = await httpJson(`${baseUrl(credentials)}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { authorization: basicAuth(credentials.username, credentials.appPassword) },
    });
    if (!res.ok) {
      const c = classify(res, 'WordPress verification');
      return { ok: false, detail: `${c.message}${res.status === 404 ? ' — check the site URL and that the REST API is enabled.' : ''}` };
    }
    const user = res.data as { name?: string; id?: number; capabilities?: Record<string, boolean> };
    if (user?.capabilities && user.capabilities.publish_posts === false) {
      return { ok: false, detail: `Connected as ${user.name}, but this role cannot publish posts.` };
    }
    return { ok: true, accountName: user?.name || credentials.username, externalId: String(user?.id ?? '') };
  },
  async publish({ account, content, media, business, log }) {
    const { credentials } = account;
    const root = baseUrl(credentials);
    const auth = basicAuth(credentials.username, credentials.appPassword);
    let featuredMedia: number | undefined;

    const image = media.find((m) => m.kind === 'image');
    if (image) {
      log('media', `Uploading ${image.filename} to the WordPress media library`);
      const up = await http(`${root}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          authorization: auth,
          'content-type': image.mime,
          'content-disposition': `attachment; filename="${image.filename.replace(/"/g, '')}"`,
        },
        body: new Uint8Array(image.buffer),
      });
      if (up.ok) {
        const m = up.data as { id?: number };
        featuredMedia = m?.id;
      } else {
        log('media', `Media upload failed, publishing without a featured image: ${errorMessage(up)}`);
      }
    }

    const bodyHtml = [
      htmlFrom(content.description || content.caption),
      content.destinationUrl
        ? `<p><a href="${content.destinationUrl}" rel="noopener">${content.cta || business.ctaPrimary || 'Learn more'}</a></p>`
        : '',
      content.hashtags.length ? `<p>${content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}</p>` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const res = await httpJson(`${root}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { authorization: auth },
      body: {
        title: content.title || content.caption.slice(0, 120),
        content: bodyHtml,
        excerpt: content.caption.slice(0, 300),
        status: 'publish',
        featured_media: featuredMedia,
      },
    });
    if (!res.ok) {
      const c = classify(res, 'WordPress publish');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const post = res.data as { id?: number; link?: string };
    return {
      ok: true,
      externalId: post?.id ? String(post.id) : undefined,
      url: publishedUrlOrNull(post?.link),
      meta: { featuredMedia },
    };
  },
  contentHint:
    'SEO-friendly promotional article or blog post for a website design business. Include a title, a short intro, the offer, and a clear CTA. 250-500 words.',
  limits: { caption: 2000, title: 120, hashtags: 6 },
};
