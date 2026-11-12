import type { PlatformAdapter } from '../types';
import { classify, http, httpJson, publishedUrlOrNull, truncate } from '../http';

const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';

export const youtube: PlatformAdapter = {
  id: 'youtube',
  name: 'YouTube Shorts',
  group: 'B',
  automation: 'automatic',
  integration: 'YouTube Data API v3 (resumable upload)',
  docsUrl: 'https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol',
  notes:
    'A Short is video, not a poster. ROYALWEB renders a vertical 1080×1920 clip from your poster (requires ffmpeg on the server) or uploads an MP4 you provided. If no renderer is available the job fails with an explicit message instead of pretending to publish.',
  connectInstructions:
    'Enable the YouTube Data API v3 in Google Cloud, configure the OAuth client in Settings, then Connect with Google and authorize uploads to your own channel.',
  permissionNotes:
    'Scope https://www.googleapis.com/auth/youtube.upload. Unverified projects upload as private until the app passes Google verification. Quota is 10,000 units/day; one upload costs 1,600 units.',
  credentialFields: [
    { key: 'accessToken', label: 'Google access token', type: 'password', required: false },
    { key: 'refreshToken', label: 'Refresh token', type: 'password', required: false },
    { key: 'defaultPrivacy', label: 'Privacy', type: 'text', required: false, placeholder: 'public | unlisted | private' },
  ],
  capabilities: { text: true, image: false, video: true, article: false },
  oauth: { provider: 'google', scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'] },
  async verify({ credentials }) {
    if (!credentials.accessToken) return { ok: false, detail: 'Use Connect with Google (YouTube upload scope).' };
    const res = await httpJson<{ items?: { id?: string; snippet?: { title?: string } }[] }>(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { authorization: `Bearer ${credentials.accessToken}` } }
    );
    if (!res.ok) {
      const c = classify(res, 'YouTube verification');
      return { ok: false, detail: c.message };
    }
    const channel = res.data?.items?.[0];
    if (!channel) return { ok: false, detail: 'This Google account has no YouTube channel. Create one before connecting.' };
    return { ok: true, accountName: channel.snippet?.title ?? 'YouTube channel', externalId: channel.id };
  },
  async publish({ account, content, media, business, log }) {
    const video = media.find((m) => m.kind === 'video');
    if (!video) {
      return {
        ok: false,
        error:
          'YouTube Shorts requires a video file. No video is attached to this campaign and the poster-to-video renderer did not produce one. Upload an MP4 (vertical, 15-60s) or enable ffmpeg rendering on the server.',
        errorCode: 'video_required',
        retryable: false,
      };
    }
    if (video.buffer.length > 250 * 1024 * 1024) {
      return { ok: false, error: 'Video exceeds the 256 MB upload limit for this pipeline.', errorCode: 'file_too_large', retryable: false };
    }
    const title = truncate(`${content.title || content.caption}${/#shorts/i.test(content.title) ? '' : ' #Shorts'}`, 100);
    const description = [
      content.description || content.caption,
      content.destinationUrl ? `\n\n${content.cta || 'Get your business website'}: ${content.destinationUrl}` : '',
      business.publicContactVisible && business.whatsappUrl ? `WhatsApp: ${business.whatsappUrl}` : '',
      content.hashtags.length ? `\n\n${content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 5000);

    log('publish', 'Starting resumable YouTube upload');
    const init = await fetch(
      `${UPLOAD}?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${account.credentials.accessToken}`,
          'content-type': 'application/json',
          'x-upload-content-type': video.mime || 'video/mp4',
          'x-upload-content-length': String(video.buffer.length),
        },
        body: JSON.stringify({
          snippet: {
            title,
            description,
            tags: content.hashtags.slice(0, 15),
            categoryId: '27',
          },
          status: {
            privacyStatus: (account.credentials.defaultPrivacy as string) || 'public',
            selfDeclaredMadeForKids: false,
          },
        }),
      }
    ).catch(() => null);

    if (!init) {
      return { ok: false, error: 'Network error starting the YouTube upload.', errorCode: 'network_error', retryable: true };
    }
    if (!init.ok) {
      const text = await init.text().catch(() => '');
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep raw */
      }
      const c = classify({ ok: false, status: init.status, data: parsed, text, headers: init.headers }, 'YouTube upload init');
      return {
        ok: false,
        error:
          init.status === 403
            ? `${c.message} — check the youtube.upload scope and daily quota (an upload costs 1,600 units).`
            : c.message,
        errorCode: c.code,
        retryable: c.retryable,
      };
    }
    const location = init.headers.get('location');
    if (!location) {
      return { ok: false, error: 'YouTube did not return an upload URL.', errorCode: 'no_upload_url', retryable: true };
    }
    log('publish', 'Uploading video bytes');
    const put = await http(location, {
      method: 'PUT',
      headers: { 'content-type': video.mime || 'video/mp4' },
      body: new Uint8Array(video.buffer),
      timeoutMs: 120_000,
    });
    if (!put.ok) {
      const c = classify(put, 'YouTube video upload');
      return { ok: false, error: c.message, errorCode: c.code, retryable: c.retryable };
    }
    const id = (put.data as { id?: string })?.id;
    return { ok: true, externalId: id, url: publishedUrlOrNull(id ? `https://www.youtube.com/shorts/${id}` : undefined) };
  },
  contentHint:
    'YouTube Shorts title (max 100 chars) and a description (max 5000) for a vertical 15-60s promo video about a business website. Include #Shorts and a CTA.',
  limits: { caption: 5000, title: 100, hashtags: 8 },
};
