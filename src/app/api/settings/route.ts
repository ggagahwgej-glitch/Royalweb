import { handler, jsonOk, parseBody, audit } from '@/lib/api';
import { getSettings, updateSettings } from '@/lib/settings';
import { settingsPatchSchema, secretSchema } from '@/lib/validation';
import { PROVIDER_CHOICES } from '@/lib/ai/providers';
import { getSecret, secretStatus, setSecret } from '@/lib/secrets';
import { ffmpegPath } from '@/lib/media/video';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const SECRET_KEYS = [
  'ai.apiKey',
  'ai.baseUrl',
  'oauth.google.clientId',
  'oauth.google.clientSecret',
  'oauth.pinterest.clientId',
  'oauth.pinterest.clientSecret',
  'oauth.linkedin.clientId',
  'oauth.linkedin.clientSecret',
  'oauth.x.clientId',
  'oauth.x.clientSecret',
  'oauth.slack.clientId',
  'oauth.slack.clientSecret',
  'oauth.tumblr.clientId',
  'oauth.tumblr.clientSecret',
];

export const GET = handler(async (_req, _ctx, auth) => {
  const settings = getSettings(auth.user.id);
  const ffmpeg = await ffmpegPath();
  return jsonOk({
    settings,
    providers: PROVIDER_CHOICES,
    secrets: secretStatus(SECRET_KEYS),
    environment: {
      publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
      aiKeyFromEnv: Boolean(process.env.ROYALWEB_AI_API_KEY),
      videoRenderer: ffmpeg ? 'ffmpeg available' : 'ffmpeg not installed — poster-to-Short rendering disabled',
      encryptionSource: process.env.ROYALWEB_ENCRYPTION_KEY ? 'environment (ROYALWEB_ENCRYPTION_KEY)' : 'auto-generated key file (data/.keys/master.key)',
      workerSecret: Boolean(process.env.ROYALWEB_WORKER_SECRET),
      timezone: settings.defaultTimezone,
    },
    contactPreviewVisible: settings.publicContactVisible,
    aiKeyMasked: getSecret('ai.apiKey') ? '••••••configured' : null,
  });
});

export const PATCH = handler(async (req, _ctx, auth) => {
  const body = await parseBody(req, settingsPatchSchema);
  const settings = updateSettings(auth.user.id, body);
  await audit('settings.updated', 'user_settings', auth.user.id, auth.user.id, { fields: Object.keys(body) });
  return jsonOk({ settings });
});

const secretBody = secretSchema.extend({ key: z.enum(SECRET_KEYS as [string, ...string[]]) });

export const POST = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') return jsonOk({ error: 'Admin only' }, { status: 403 });
  const body = await parseBody(req, secretBody);
  setSecret(body.key, body.value, auth.user.id);
  await audit('secret.updated', 'app_secret', body.key, auth.user.id, { configured: Boolean(body.value) });
  return jsonOk({ secrets: secretStatus(SECRET_KEYS) });
});
