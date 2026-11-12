import type { PlatformAdapter } from '../types';
import { classify, http, httpJson } from '../http';

const DEFAULT_PDS = 'https://bsky.social';

function pds(creds: Record<string, string>) {
  return (creds.pds || DEFAULT_PDS).replace(/\/+$/, '');
}

interface BskySession {
  accessJwt: string;
  refreshJwt?: string;
  did: string;
  handle: string;
}

export const bluesky: PlatformAdapter = {
  id: 'bluesky',
  name: 'Bluesky',
  group: 'A',
  automation: 'automatic',
  integration: 'Bluesky AT Protocol (com.atproto)',
  docsUrl: 'https://docs.bsky.app/docs/get-started',
  notes:
    'Publishes to your own Bluesky account using an App Password — never your main password. Posts are limited to 300 characters; a link card facet is attached automatically.',
  connectInstructions:
    'In Bluesky: Settings → Privacy and Security → App Passwords → Add App Password. Enter your handle (e.g. yourname.bsky.social) and that app password.',
  permissionNotes: 'App Passwords are revocable per-app tokens. The https://bsky.social PDS is used by default; self-hosted PDS URLs are supported.',
  credentialFields: [
    { key: 'handle', label: 'Handle', type: 'text', required: true, placeholder: 'yourname.bsky.social' },
    { key: 'appPassword', label: 'App Password', type: 'password', required: true, placeholder: 'xxxx-xxxx-xxxx-xxxx' },
    { key: 'pds', label: 'PDS URL (optional)', type: 'url', required: false, placeholder: 'https://bsky.social' },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  async verify({ credentials }) {
    const res = await httpJson<BskySession>(`${pds(credentials)}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      body: { identifier: credentials.handle, password: credentials.appPassword },
    });
    if (!res.ok) {
      const c = classify(res, 'Bluesky login');
      return { ok: false, detail: `${c.message} — use an App Password, not your account password.` };
    }
    const session = res.data as BskySession;
    return { ok: true, accountName: `@${session.handle}`, externalId: session.did, meta: { did: session.did, handle: session.handle } };
  },
  async publish({ account, content, media, business, log }) {
    const root = pds(account.credentials);
    const sessionRes = await httpJson<BskySession>(`${root}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      body: { identifier: account.credentials.handle, password: account.credentials.appPassword },
    });
    if (!sessionRes.ok) {
      const c = classify(sessionRes, 'Bluesky session');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const session = sessionRes.data as BskySession;
    const auth = { authorization: `Bearer ${session.accessJwt}` };

    const images: { alt: string; image: unknown }[] = [];
    for (const item of media.filter((m) => m.kind === 'image').slice(0, 4)) {
      log('media', `Uploading ${item.filename} as an AT Protocol blob`);
      const up = await http(`${root}/xrpc/com.atproto.repo.uploadBlob`, {
        method: 'POST',
        headers: { ...auth, 'content-type': item.mime },
        body: new Uint8Array(item.buffer),
      });
      if (!up.ok) {
        const c = classify(up, 'Bluesky blob upload');
        return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
      }
      const blob = (up.data as { blob?: unknown })?.blob;
      if (blob) images.push({ alt: content.altText || item.altText || content.title, image: blob });
    }

    let text = content.caption.trim();
    if (content.cta && !text.includes(content.cta)) text += `\n\n${content.cta}`;
    if (content.destinationUrl && !text.includes(content.destinationUrl)) text += `\n${content.destinationUrl}`;
    if (content.hashtags.length) {
      const tags = content.hashtags.slice(0, 3).map((h) => `#${h.replace(/^#/, '')}`).join(' ');
      if (!text.includes(tags)) text += `\n\n${tags}`;
    }
    if (text.length > 300) text = `${text.slice(0, 297).trimEnd()}…`;

    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
    };
    if (content.destinationUrl) {
      const idx = text.indexOf(content.destinationUrl);
      if (idx >= 0) {
        const bytes = new TextEncoder().encode(text);
        const prefix = new TextEncoder().encode(text.slice(0, idx)).length;
        const length = new TextEncoder().encode(content.destinationUrl).length;
        record.facets = [
          {
            index: { byteStart: prefix, byteEnd: prefix + length },
            features: [{ $type: 'app.bsky.richtext.facet#link', uri: content.destinationUrl }],
          },
        ];
      }
    }
    if (images.length) {
      record.embed = { $type: 'app.bsky.embed.images', images };
    }

    const res = await httpJson<{ uri?: string; cid?: string }>(
      `${root}/xrpc/com.atproto.repo.createRecord`,
      {
        method: 'POST',
        headers: auth,
        body: {
          repo: session.did,
          collection: 'app.bsky.feed.post',
          record,
          validate: true,
        },
      }
    );
    if (!res.ok) {
      const c = classify(res, 'Bluesky post');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const rkey = (res.data?.uri ?? '').split('/').pop();
    return {
      ok: true,
      externalId: res.data?.uri,
      url: rkey ? `https://bsky.app/profile/${session.handle}/post/${rkey}` : undefined,
    };
  },
  contentHint:
    'Short conversational Bluesky post under 300 characters. Direct, human tone. One link, max 3 hashtags.',
  limits: { caption: 300, hashtags: 3 },
};
