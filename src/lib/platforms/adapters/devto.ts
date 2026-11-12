import type { PlatformAdapter } from '../types';
import { classify, httpJson, publishedUrlOrNull, truncate } from '../http';

const API = 'https://dev.to/api';

export const devto: PlatformAdapter = {
  id: 'devto',
  name: 'DEV.to',
  group: 'A',
  automation: 'automatic',
  integration: 'Forem / DEV API v1',
  docsUrl: 'https://developers.forem.com/api/v1#tag/articles/operation/createArticle',
  notes:
    'DEV.to is for genuine developer education — the adapter publishes a real article, not an advertisement. Cover images need a public URL (set PUBLIC_BASE_URL or provide your own).',
  connectInstructions:
    'DEV.to → Settings → Extensions → DEV Community API Keys → generate a key. Paste it here. Works with any Forem instance by changing the API base URL.',
  permissionNotes: 'An API key acts as your own account. Promotional articles that are pure advertising can be moderated by DEV.to.',
  credentialFields: [
    { key: 'apiKey', label: 'DEV API key', type: 'password', required: true },
    { key: 'apiBase', label: 'API base (optional)', type: 'url', required: false, placeholder: 'https://dev.to/api' },
  ],
  capabilities: { text: true, image: true, video: false, article: true, imageViaUrl: true },
  async verify({ credentials }) {
    const base = (credentials.apiBase || API).replace(/\/+$/, '');
    const res = await httpJson<{ username?: string; name?: string; id?: number }>(`${base}/users/me`, {
      headers: { 'api-key': credentials.apiKey },
    });
    if (!res.ok) {
      const c = classify(res, 'DEV.to verification');
      return { ok: false, detail: `${c.message} — generate the key at Settings → Extensions.` };
    }
    return { ok: true, accountName: `@${res.data?.username}`, externalId: String(res.data?.id ?? '') };
  },
  async publish({ account, content, media, business, log }) {
    const base = (account.credentials.apiBase || API).replace(/\/+$/, '');
    const image = media.find((m) => m.kind === 'image');
    let cover: string | undefined;
    if (image?.publicUrl) cover = image.publicUrl;
    else if (image) log('media', 'No public media URL available (set PUBLIC_BASE_URL) — article published without a cover image. Upload the poster manually as the cover.');

    const tags = content.hashtags
      .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean)
      .slice(0, 4);

    const body = [
      content.description || content.caption,
      content.destinationUrl ? `\n\n---\n\n**${content.cta || 'Learn more'}:** ${content.destinationUrl}` : '',
      `\n\n*Published by ${business.businessName}${business.tagline ? ` — ${business.tagline}` : ''}.*`,
    ]
      .filter(Boolean)
      .join('\n');

    const res = await httpJson<{ id?: number; url?: string; slug?: string }>(`${base}/articles`, {
      method: 'POST',
      headers: { 'api-key': account.credentials.apiKey },
      body: {
        article: {
          title: truncate(content.title || content.caption, 128),
          published: true,
          body_markdown: body,
          tags,
          canonical_url: content.destinationUrl || undefined,
          main_image: cover,
          description: truncate(content.caption, 150),
        },
      },
    });
    if (!res.ok) {
      const c = classify(res, 'DEV.to publish');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    return { ok: true, externalId: String(res.data?.id ?? ''), url: publishedUrlOrNull(res.data?.url) };
  },
  contentHint:
    'A genuinely useful technical article for developers and small business owners about website topics (speed, mobile layout, SEO basics, landing pages). 600-900 words, markdown headings and a code-free explanatory tone. Mention the business only in a short closing note.',
  limits: { caption: 8000, title: 128, hashtags: 4 },
};
