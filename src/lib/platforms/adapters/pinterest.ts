import type { PlatformAdapter } from '../types';
import { classify, http, httpJson, publishedUrlOrNull, truncate } from '../http';

const API = 'https://api.pinterest.com/v5';

export const pinterest: PlatformAdapter = {
  id: 'pinterest',
  name: 'Pinterest',
  group: 'B',
  automation: 'approval',
  integration: 'Pinterest API v5 (OAuth 2.0)',
  docsUrl: 'https://developers.pinterest.com/docs/api/v5/pins-create/',
  notes:
    'Pinterest requires app review ("standard access") before pins can be created through the API; trial access is restricted to your own test account. Board selection is required.',
  connectInstructions:
    'Register an app at developers.pinterest.com, add the client ID/secret in Settings → Integrations, then Connect with Pinterest. Pick an authorized board.',
  permissionNotes: 'Scopes: pins:write, boards:read, user_accounts:read. The app must have standard access approved by Pinterest.',
  credentialFields: [
    { key: 'accessToken', label: 'Access token', type: 'password', required: false },
    { key: 'refreshToken', label: 'Refresh token', type: 'password', required: false },
    { key: 'boardId', label: 'Board ID', type: 'text', required: true, help: 'Listed after connecting (Boards API).' },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  oauth: { provider: 'pinterest', scopes: ['pins:write', 'boards:read', 'user_accounts:read'] },
  async verify({ credentials }) {
    if (!credentials.accessToken) return { ok: false, detail: 'Use Connect with Pinterest to authorize the account.' };
    const auth = { authorization: `Bearer ${credentials.accessToken}` };
    const me = await httpJson<{ username?: string; account_type?: string }>(`${API}/user_account`, { headers: auth });
    if (!me.ok) {
      const c = classify(me, 'Pinterest verification');
      return { ok: false, detail: `${c.message} — if this is a 403, your app likely needs standard access approval.` };
    }
    const boards = await httpJson<{ items?: { id: string; name: string }[] }>(`${API}/boards?page_size=100`, { headers: auth });
    const list = boards.data?.items ?? [];
    const board = credentials.boardId ? list.find((b) => b.id === credentials.boardId) : list[0];
    if (!board) {
      return { ok: false, detail: 'No Pinterest boards found. Create a board first, then reconnect.' };
    }
    return {
      ok: true,
      accountName: `${me.data?.username ?? 'Pinterest'} → ${board.name}`,
      externalId: board.id,
      meta: { boards: list, boardName: board.name, username: me.data?.username },
    };
  },
  async publish({ account, content, media, log }) {
    const auth = { authorization: `Bearer ${account.credentials.accessToken}` };
    const boardId = account.credentials.boardId || (account.meta.boards as { id: string }[] | undefined)?.[0]?.id;
    if (!boardId) return { ok: false, error: 'No Pinterest board selected.', errorCode: 'missing_board', retryable: false };
    const image = media.find((m) => m.kind === 'image');
    if (!image) return { ok: false, error: 'Pinterest requires an image for a pin.', errorCode: 'missing_image', retryable: false };

    log('media', 'Registering media upload with Pinterest');
    const register = await httpJson<{
      media_id?: string;
      upload_url?: string;
      upload_parameters?: Record<string, string>;
    }>(`${API}/media`, { method: 'POST', headers: auth, body: { media_type: 'image' } });
    if (!register.ok) {
      const c = classify(register, 'Pinterest media registration');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const mediaId = register.data?.media_id;
    const uploadUrl = register.data?.upload_url;
    if (!mediaId || !uploadUrl) {
      return { ok: false, error: 'Pinterest did not return an upload URL.', errorCode: 'media_register_failed', retryable: true };
    }

    const form = new FormData();
    for (const [k, v] of Object.entries(register.data?.upload_parameters ?? {})) form.set(k, String(v));
    form.set('file', new Blob([new Uint8Array(image.buffer)], { type: image.mime }), image.filename);
    const upload = await http(uploadUrl, { method: 'POST', body: form });
    if (!upload.ok) {
      const c = classify(upload, 'Pinterest media upload');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }

    log('publish', 'Creating pin');
    const pin = await httpJson<{ id?: string }>(`${API}/pins`, {
      method: 'POST',
      headers: auth,
      body: {
        board_id: boardId,
        title: truncate(content.title || content.caption, 100),
        description: truncate(content.description || content.caption, 500),
        alt_text: truncate(content.altText || content.title, 500),
        link: content.destinationUrl || undefined,
        media_source: { source_type: 'media_id', media_id: mediaId },
      },
    });
    if (!pin.ok) {
      const c = classify(pin, 'Pinterest pin creation');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const id = pin.data?.id;
    return { ok: true, externalId: id, url: publishedUrlOrNull(id ? `https://www.pinterest.com/pin/${id}/` : undefined) };
  },
  contentHint:
    'SEO-friendly Pinterest pin: keyword-rich title (max 100 chars), 2-4 sentence description with search terms, destination link, 3-5 hashtags. Inspiring but practical.',
  limits: { caption: 500, title: 100, hashtags: 5 },
};
