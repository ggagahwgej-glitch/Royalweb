import type { PlatformAdapter } from '../types';
import { classify, http, httpJson } from '../http';

function base(creds: Record<string, string>) {
  return creds.homeserverUrl.replace(/\/+$/, '');
}

export const matrix: PlatformAdapter = {
  id: 'matrix',
  name: 'Matrix',
  group: 'B',
  automation: 'automatic',
  integration: 'Matrix Client-Server API',
  docsUrl: 'https://spec.matrix.org/latest/client-server-api/#sending-messages',
  notes:
    'Posts into Matrix rooms your account has joined. Images are uploaded to the homeserver media repository and sent as m.image events with a fallback text body.',
  connectInstructions:
    'Use an access token for your own Matrix account (Element: Settings → Help & About → Access Token) and the room ID (starts with !). The account must already be joined to the room.',
  permissionNotes: 'The token acts as your user; the account needs permission to send messages in the room (power level 0 or higher).',
  credentialFields: [
    { key: 'homeserverUrl', label: 'Homeserver URL', type: 'url', required: true, placeholder: 'https://matrix.org' },
    { key: 'accessToken', label: 'Access token', type: 'password', required: true },
    { key: 'roomId', label: 'Room ID', type: 'text', required: true, placeholder: '!abcdef:matrix.org' },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  async verify({ credentials }) {
    const res = await httpJson<{ user_id?: string; device_id?: string }>(
      `${base(credentials)}/_matrix/client/v3/account/whoami`,
      { headers: { authorization: `Bearer ${credentials.accessToken}` } }
    );
    if (!res.ok) {
      const c = classify(res, 'Matrix verification');
      return { ok: false, detail: c.message };
    }
    const join = await httpJson<{ room_id?: string }>(
      `${base(credentials)}/_matrix/client/v3/rooms/${encodeURIComponent(credentials.roomId)}/state/m.room.name`,
      { headers: { authorization: `Bearer ${credentials.accessToken}` } }
    ).catch(() => null);
    const name = join?.ok ? (join.data as { name?: string })?.name : undefined;
    return {
      ok: true,
      accountName: `${res.data?.user_id} → ${name || credentials.roomId}`,
      externalId: res.data?.user_id,
      meta: { userId: res.data?.user_id, roomId: credentials.roomId },
    };
  },
  async publish({ account, content, media, business, log }) {
    const root = base(account.credentials);
    const room = encodeURIComponent(account.credentials.roomId);
    const auth = { authorization: `Bearer ${account.credentials.accessToken}` };
    const txn = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const image = media.find((m) => m.kind === 'image');
    let uploaded: { content_uri?: string } | null = null;

    if (image) {
      log('media', `Uploading ${image.filename} to the Matrix media repository`);
      let up = await http(
        `${root}/_matrix/media/v3/upload?filename=${encodeURIComponent(image.filename)}`,
        { method: 'POST', headers: { ...auth, 'content-type': image.mime }, body: new Uint8Array(image.buffer) }
      );
      if (!up.ok) {
        log('media', `media/v3 upload returned HTTP ${up.status}; trying the authenticated media endpoint`);
        up = await http(
          `${root}/_matrix/client/v1/media/upload?filename=${encodeURIComponent(image.filename)}`,
          { method: 'POST', headers: { ...auth, 'content-type': image.mime }, body: new Uint8Array(image.buffer) }
        );
      }
      if (!up.ok) {
        const c = classify(up, 'Matrix media upload');
        return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
      }
      uploaded = up.data as { content_uri?: string };
    }

    const text = [
      content.caption,
      content.cta,
      content.destinationUrl,
      content.hashtags.length ? content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ') : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const body = uploaded?.content_uri
      ? {
          msgtype: 'm.image',
          body: text || image?.filename,
          url: uploaded.content_uri,
          info: { mimetype: image?.mime, w: image?.width ?? undefined, h: image?.height ?? undefined },
        }
      : { msgtype: 'm.text', body: `${text}\n\n${business.websiteUrl}`.trim(), format: 'org.matrix.custom.html' };

    const res = await httpJson<{ event_id?: string }>(
      `${root}/_matrix/client/v3/rooms/${room}/send/m.room.message/${txn}`,
      { method: 'PUT', headers: auth, body }
    );
    if (!res.ok) {
      const c = classify(res, 'Matrix send');
      return {
        ok: false,
        error: `${c.message}${res.status === 403 ? ' — the account must be joined to the room with permission to post.' : ''}`,
        errorCode: c.code,
        retryable: c.retryable,
      };
    }
    const eventId = res.data?.event_id;
    return {
      ok: true,
      externalId: eventId,
      url: eventId ? `https://matrix.to/#/${account.credentials.roomId}/${eventId}` : undefined,
    };
  },
  contentHint:
    'Community-friendly Matrix room message (max 800 chars). Plain, helpful, no marketing hype, one link, minimal hashtags.',
  limits: { caption: 800, hashtags: 3 },
};
