import type { PlatformAdapter } from '../types';
import { classify, http, httpJson } from '../http';

const API = 'https://slack.com/api';

interface SlackAuth {
  ok: boolean;
  error?: string;
  team?: string;
  user?: string;
  url?: string;
  team_id?: string;
}

export const slack: PlatformAdapter = {
  id: 'slack',
  name: 'Slack',
  group: 'B',
  automation: 'automatic',
  integration: 'Slack Web API (bot token)',
  docsUrl: 'https://api.slack.com/methods/files.completeUploadExternal',
  notes:
    'Uses the current external file-upload flow (files.getUploadURLExternal → upload → files.completeUploadExternal); the deprecated files.upload endpoint is not used. Bot must be a member of the target channel.',
  connectInstructions:
    'Create a Slack app, add bot scopes chat:write, files:write and channels:read, install it to your workspace, invite the bot to the target channel, then paste the bot token (xoxb-…) and channel ID.',
  permissionNotes: 'Scopes: chat:write, files:write, channels:read. Files can only be posted to channels the bot has joined.',
  credentialFields: [
    { key: 'botToken', label: 'Bot token', type: 'password', required: true, placeholder: 'xoxb-…' },
    { key: 'channelId', label: 'Channel ID', type: 'text', required: true, placeholder: 'C0123456789' },
  ],
  capabilities: { text: true, image: true, video: false, article: false },
  async verify({ credentials }) {
    const auth = await httpJson<SlackAuth>(`${API}/auth.test`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credentials.botToken}` },
    });
    if (!auth.ok || !auth.data?.ok) {
      return { ok: false, detail: `Slack rejected the token: ${auth.data?.error ?? `HTTP ${auth.status}`}` };
    }
    const info = await httpJson<{ ok: boolean; channel?: { name?: string; is_member?: boolean }; error?: string }>(
      `${API}/conversations.info?channel=${encodeURIComponent(credentials.channelId)}`,
      { headers: { authorization: `Bearer ${credentials.botToken}` } }
    );
    if (!info.ok || !info.data?.ok) {
      return { ok: false, detail: `Token is valid for ${auth.data?.team}, but the channel was not found: ${info.data?.error ?? info.status}` };
    }
    return {
      ok: true,
      accountName: `${auth.data?.team} → #${info.data?.channel?.name}`,
      externalId: credentials.channelId,
      meta: { team: auth.data?.team, teamId: auth.data?.team_id, isMember: info.data?.channel?.is_member },
    };
  },
  async publish({ account, content, media, business, log }) {
    const token = account.credentials.botToken;
    const channel = account.credentials.channelId;
    const auth = { authorization: `Bearer ${token}` };
    const text = [
      content.caption.trim(),
      content.cta ? `\n${content.cta}` : '',
      content.destinationUrl ? `\n<${content.destinationUrl}|${content.cta || business.websiteUrl || 'Open link'}>` : '',
    ].join('');

    const image = media.find((m) => m.kind === 'image');
    if (image) {
      log('media', 'Requesting external upload URL from Slack');
      const params = new URLSearchParams({
        filename: image.filename,
        length: String(image.buffer.length),
      });
      const urlRes = await http(`${API}/files.getUploadURLExternal`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const urlData = urlRes.data as { ok?: boolean; upload_url?: string; file_id?: string; error?: string };
      if (!urlRes.ok || !urlData?.ok || !urlData.upload_url || !urlData.file_id) {
        return { ok: false, error: `Slack upload URL failed: ${urlData?.error ?? urlRes.status}`, errorCode: 'upload_init_failed', retryable: urlRes.status >= 500 };
      }
      const upload = await http(urlData.upload_url, {
        method: 'POST',
        headers: { 'content-type': image.mime },
        body: new Uint8Array(image.buffer),
      });
      if (!upload.ok) {
        const c = classify(upload, 'Slack file upload');
        return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
      }
      log('publish', 'Completing Slack external upload and sharing to channel');
      const complete = await http(`${API}/files.completeUploadExternal`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          files: JSON.stringify([{ id: urlData.file_id, title: image.filename }]),
          channel_id: channel,
          initial_comment: text,
        }).toString(),
      });
      const done = complete.data as { ok?: boolean; error?: string; files?: { id?: string }[] };
      if (!complete.ok || !done?.ok) {
        return { ok: false, error: `Slack could not share the file: ${done?.error ?? complete.status}`, errorCode: 'upload_complete_failed', retryable: complete.status >= 500 };
      }
      return { ok: true, externalId: done?.files?.[0]?.id, meta: { channel, fileId: done?.files?.[0]?.id } };
    }

    log('publish', 'Posting Slack message');
    const res = await httpJson<{ ok?: boolean; error?: string; ts?: string }>(`${API}/chat.postMessage`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json; charset=utf-8' },
      body: { channel, text, unfurl_links: true },
    });
    if (!res.ok || !res.data?.ok) {
      return { ok: false, error: `Slack post failed: ${res.data?.error ?? res.status}`, errorCode: 'slack_error', retryable: res.status >= 500 };
    }
    let permalink: string | undefined;
    if (res.data?.ts) {
      const link = await httpJson<{ ok?: boolean; permalink?: string }>(
        `${API}/chat.getPermalink?channel=${encodeURIComponent(channel)}&message_ts=${encodeURIComponent(res.data.ts)}`,
        { headers: auth }
      );
      permalink = link.data?.permalink;
    }
    return { ok: true, externalId: res.data?.ts, url: permalink };
  },
  contentHint:
    'Short, well-formatted Slack update for a team/marketing channel: plain text with a headline line, 2-3 bullets, and a link. No hashtags, no markdown tables.',
  limits: { caption: 1500, hashtags: 0 },
};
