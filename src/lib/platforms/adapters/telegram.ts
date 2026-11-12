import type { PlatformAdapter } from '../types';
import { classify, composePostBody, http, httpJson } from '../http';

const API = 'https://api.telegram.org';

export const telegram: PlatformAdapter = {
  id: 'telegram',
  name: 'Telegram',
  group: 'A',
  automation: 'automatic',
  integration: 'Telegram Bot API',
  docsUrl: 'https://core.telegram.org/bots/api#sendphoto',
  notes:
    'Publishes to a channel or group where your own bot is an administrator. Multiple images are sent as an album when more than one poster is attached.',
  connectInstructions:
    '1) Message @BotFather, create a bot, copy the token. 2) Add the bot to your channel as an administrator with "Post messages". 3) Enter the bot token and the channel username (@mychannel) or numeric chat ID (-100...).',
  permissionNotes: 'The bot must be an admin in the target chat with post-message rights. Bot tokens grant full control of that bot only.',
  credentialFields: [
    { key: 'botToken', label: 'Bot token', type: 'password', required: true, placeholder: '123456:ABC-DEF…' },
    { key: 'chatId', label: 'Channel / chat', type: 'text', required: true, placeholder: '@yourchannel or -1001234567890' },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  async verify({ credentials }) {
    const me = await httpJson<{ ok: boolean; result?: { username?: string; first_name?: string } }>(
      `${API}/bot${credentials.botToken}/getMe`
    );
    if (!me.ok || !(me.data as { ok?: boolean })?.ok) {
      return { ok: false, detail: 'Telegram rejected the bot token. Copy it again from @BotFather.' };
    }
    const chat = await httpJson<{
      ok: boolean;
      result?: { title?: string; username?: string; id?: number };
      description?: string;
    }>(`${API}/bot${credentials.botToken}/getChat?chat_id=${encodeURIComponent(credentials.chatId)}`);
    if (!chat.ok || !(chat.data as { ok?: boolean })?.ok) {
      return {
        ok: false,
        detail: `Bot is valid (@${me.data?.result?.username}) but the channel was not reachable: ${
          (chat.data as { description?: string })?.description ?? 'unknown error'
        }. Add the bot as a channel administrator.`,
      };
    }
    const result = chat.data?.result;
    return {
      ok: true,
      accountName: result?.title || result?.username || credentials.chatId,
      externalId: String(result?.id ?? ''),
      meta: { chatUsername: result?.username ?? null, botUsername: me.data?.result?.username ?? null },
    };
  },
  async publish({ account, content, media, business, log }) {
    const token = account.credentials.botToken;
    const chatId = account.credentials.chatId;
    const caption = composePostBody(content.caption, {
      cta: content.cta || business.ctaPrimary,
      url: content.destinationUrl,
      whatsapp: business.publicContactVisible ? business.whatsappUrl : '',
      hashtags: content.hashtags,
      maxLength: 1024,
    });
    const images = media.filter((m) => m.kind === 'image');
    if (!images.length) {
      const res = await httpJson(`${API}/bot${token}/sendMessage`, {
        method: 'POST',
        body: { chat_id: chatId, text: caption, disable_web_page_preview: false },
      });
      if (!res.ok) {
        const c = classify(res, 'Telegram send');
        return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
      }
      const msg = res.data as { result?: { message_id?: number } };
      return {
        ok: true,
        externalId: String(msg?.result?.message_id ?? ''),
        url: telegramUrl(account, msg?.result?.message_id),
      };
    }

    if (images.length === 1) {
      log('media', 'Sending single photo with caption');
      const form = new FormData();
      form.set('chat_id', chatId);
      form.set('caption', caption);
      form.set('parse_mode', 'HTML');
      form.set('photo', new Blob([new Uint8Array(images[0].buffer)], { type: images[0].mime }), images[0].filename);
      const res = await http(`${API}/bot${token}/sendPhoto`, { method: 'POST', body: form });
      if (!res.ok) {
        const c = classify(res, 'Telegram sendPhoto');
        return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
      }
      const msg = res.data as { result?: { message_id?: number } };
      return { ok: true, externalId: String(msg?.result?.message_id ?? ''), url: telegramUrl(account, msg?.result?.message_id) };
    }

    log('media', `Sending ${images.length} images as a Telegram album`);
    const form = new FormData();
    form.set('chat_id', chatId);
    const album = images.slice(0, 10).map((img, i) => {
      form.set(`photo${i}`, new Blob([new Uint8Array(img.buffer)], { type: img.mime }), img.filename);
      return { type: 'photo', media: `attach://photo${i}`, caption: i === 0 ? caption : undefined, parse_mode: i === 0 ? 'HTML' : undefined };
    });
    form.set('media', JSON.stringify(album));
    const res = await http(`${API}/bot${token}/sendMediaGroup`, { method: 'POST', body: form });
    if (!res.ok) {
      const c = classify(res, 'Telegram sendMediaGroup');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const msgs = res.data as { result?: { message_id?: number }[] };
    return { ok: true, externalId: String(msgs?.result?.[0]?.message_id ?? ''), url: telegramUrl(account, msgs?.result?.[0]?.message_id) };
  },
  contentHint:
    'Clear promotional Telegram channel message: 2-4 short lines, one emoji at most, offer price and a direct link. No hashtag spam (max 3).',
  limits: { caption: 1024, hashtags: 3 },
};

function telegramUrl(account: { credentials: Record<string, string>; meta: Record<string, unknown> }, messageId?: number) {
  const username =
    (account.meta.chatUsername as string | undefined) ||
    (account.credentials.chatId.startsWith('@') ? account.credentials.chatId.slice(1) : undefined);
  if (!username || !messageId) return undefined;
  return `https://t.me/${username}/${messageId}`;
}
