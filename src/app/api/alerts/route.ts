import { z } from 'zod';
import { handler, jsonOk, parseBody, audit, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { alertSecretStatus, listAlerts, readAlertConfig, raiseAlert, writeAlertConfig } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  return jsonOk({
    config: readAlertConfig(),
    secrets: alertSecretStatus(),
    events: listAlerts(20),
    triggers: [
      { code: 'worker_dead', when: 'No worker heartbeat for 2 minutes' },
      { code: 'token_expired', when: 'A platform token expires or is rejected outright' },
      { code: 'retries_exhausted', when: 'A publishing job used every retry attempt' },
      { code: 'snapshot_failed', when: 'A scheduled database snapshot could not be written' },
      { code: 'rss_failed', when: 'A feed URL stops returning articles' },
    ],
  });
});

const configSchema = z.object({
  telegramBotToken: z.string().max(200).optional(),
  telegramChatId: z.string().max(60).optional(),
  email: z.union([z.string().email().max(200), z.literal('')]).optional(),
  webhookUrl: z.union([z.string().url().max(500), z.literal('')]).optional(),
  enabled: z.boolean().optional(),
});

export const POST = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  enforceRateLimit(`alerts-config:${auth.user.id}`, 20, 600);
  const body = await parseBody(req, configSchema);
  const config = writeAlertConfig({ ...body, userId: auth.user.id });
  await audit('alerts.configured', 'system', 'alerts', auth.user.id, {
    channels: config.channels,
    enabled: config.enabled,
  });
  return jsonOk({ config, secrets: alertSecretStatus() });
});

const testSchema = z.object({ test: z.literal(true) });

/** Send a real end-to-end test alert through every configured channel. */
export const PUT = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  enforceRateLimit(`alerts-test:${auth.user.id}`, 5, 600);
  await parseBody(req, testSchema);
  const result = await raiseAlert({
    code: 'test',
    title: 'Test alert from ROYALWEB AUTOPILOT',
    detail: `If you can read this, ${readAlertConfig().channels.join(' + ') || 'no channel'} alerting works. Nothing is broken.`,
    severity: 'warning',
    workspaceId: auth.workspaceId,
    dedupeMinutes: 0,
    force: true,
  });
  return jsonOk({ result });
});
