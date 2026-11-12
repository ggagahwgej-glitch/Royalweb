import type { PlatformAdapter } from '../types';
import { classify, composePostBody, http, httpJson } from '../http';

const API = 'https://discord.com/api/v10';

export const discord: PlatformAdapter = {
  id: 'discord',
  name: 'Discord',
  group: 'A',
  automation: 'automatic',
  integration: 'Discord Bot API / Channel Webhooks',
  docsUrl: 'https://discord.com/developers/docs/resources/message#create-message',
  notes:
    'Publishes to a server channel you control, using either a bot token or a channel webhook. Webhooks are the simplest option for a single channel.',
  connectInstructions:
    'Option A (recommended): Server Settings → Integrations → Webhooks → New Webhook → copy the webhook URL. Option B: create a bot application, invite it with Send Messages permission, and enter the bot token plus the channel ID.',
  permissionNotes:
    'Bot: needs View Channel + Send Messages + Attach Files in that channel. Webhook: grants posting rights to that one channel only.',
  credentialFields: [
    { key: 'webhookUrl', label: 'Channel webhook URL (option A)', type: 'password', required: false, placeholder: 'https://discord.com/api/webhooks/…' },
    { key: 'botToken', label: 'Bot token (option B)', type: 'password', required: false },
    { key: 'channelId', label: 'Channel ID (option B)', type: 'text', required: false },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  async verify({ credentials }) {
    if (credentials.webhookUrl) {
      if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(credentials.webhookUrl)) {
        return { ok: false, detail: 'That does not look like a Discord webhook URL.' };
      }
      const res = await httpJson(credentials.webhookUrl);
      if (!res.ok) {
        return { ok: false, detail: `Discord rejected the webhook (HTTP ${res.status}). Regenerate it in Server Settings → Integrations.` };
      }
      const hook = res.data as { name?: string; channel_id?: string; guild_id?: string; id?: string };
      return {
        ok: true,
        accountName: `${hook.name ?? 'Webhook'} (channel ${hook.channel_id ?? 'unknown'})`,
        externalId: hook.id ?? '',
        meta: { mode: 'webhook', channelId: hook.channel_id, guildId: hook.guild_id },
      };
    }
    if (!credentials.botToken || !credentials.channelId) {
      return { ok: false, detail: 'Provide either a webhook URL, or a bot token and channel ID.' };
    }
    const me = await httpJson<{ username?: string; id?: string }>(`${API}/users/@me`, {
      headers: { authorization: `Bot ${credentials.botToken}` },
    });
    if (!me.ok) return { ok: false, detail: `Discord rejected the bot token (HTTP ${me.status}).` };
    const channel = await httpJson<{ name?: string; guild_id?: string }>(`${API}/channels/${credentials.channelId}`, {
      headers: { authorization: `Bot ${credentials.botToken}` },
    });
    if (!channel.ok) {
      return { ok: false, detail: `Bot is valid (@${me.data?.username}) but cannot see channel ${credentials.channelId}. Check the ID and the bot permissions.` };
    }
    return {
      ok: true,
      accountName: `#${channel.data?.name ?? credentials.channelId}`,
      externalId: credentials.channelId,
      meta: { mode: 'bot', guildId: channel.data?.guild_id, botUsername: me.data?.username },
    };
  },
  async publish({ account, content, media, business, log }) {
    const text = composePostBody(content.caption, {
      cta: content.cta || business.ctaPrimary,
      url: content.destinationUrl,
      whatsapp: business.publicContactVisible ? business.whatsappUrl : '',
      hashtags: content.hashtags,
      includeTags: false,
      maxLength: 2000,
    });
    const webhook = account.credentials.webhookUrl;
    const isWebhook = Boolean(webhook);
    const base = isWebhook ? webhook : `${API}/channels/${account.credentials.channelId}/messages`;
    const authHeaders: Record<string, string> = isWebhook
      ? {}
      : { authorization: `Bot ${account.credentials.botToken}` };
    const url = isWebhook ? `${base}?wait=true` : base;

    const image = media.find((m) => m.kind === 'image');
    if (image) {
      log('media', `Attaching ${image.filename}`);
      const form = new FormData();
      form.set('payload_json', JSON.stringify({ content: text }));
      form.set('files[0]', new Blob([new Uint8Array(image.buffer)], { type: image.mime }), image.filename);
      const res = await http(url, { method: 'POST', headers: authHeaders, body: form });
      if (!res.ok) {
        const c = classify(res, 'Discord message');
        return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
      }
      const msg = res.data as { id?: string; channel_id?: string };
      return {
        ok: true,
        externalId: msg?.id,
        url: msg?.channel_id
          ? `https://discord.com/channels/${(account.meta.guildId as string) || '@me'}/${msg.channel_id}/${msg.id}`
          : undefined,
      };
    }
    const res = await httpJson(url, { method: 'POST', headers: authHeaders, body: { content: text } });
    if (!res.ok) {
      const c = classify(res, 'Discord message');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const msg = res.data as { id?: string; channel_id?: string };
    return {
      ok: true,
      externalId: msg?.id,
      url: msg?.channel_id
        ? `https://discord.com/channels/${(account.meta.guildId as string) || '@me'}/${msg.channel_id}/${msg.id}`
        : undefined,
    };
  },
  contentHint:
    'Friendly, formatted Discord announcement (max 2000 chars). Short lines, one bold headline line, link at the end. No hashtags.',
  limits: { caption: 2000, hashtags: 0 },
};
