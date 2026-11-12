import 'server-only';
import { all, get, newId, nowIso, run } from '@/lib/db';
import { getSecret, setSecret, secretStatus } from '@/lib/secrets';

/**
 * External alerts.
 *
 * Three things are worth waking someone up for: the publishing worker stops
 * beating, a platform token stops being refreshable, and a job burns through
 * every retry. Everything else stays in the dashboard.
 *
 * Delivery is deliberately simple and real: a Telegram Bot API `sendMessage`
 * call or an SMTP message through the existing sender. Failures are recorded on
 * the alert row instead of being swallowed, so the UI can show "we tried and it
 * failed" rather than a green tick that means nothing.
 */

export type AlertCode =
  | 'worker_dead'
  | 'token_expired'
  | 'retries_exhausted'
  | 'snapshot_failed'
  | 'rss_failed'
  | 'test';

export const ALERT_CODES: AlertCode[] = [
  'worker_dead',
  'token_expired',
  'retries_exhausted',
  'snapshot_failed',
  'rss_failed',
  'test',
];

const SECRET_TELEGRAM_TOKEN = 'alerts.telegramBotToken';
const SECRET_TELEGRAM_CHAT = 'alerts.telegramChatId';
const SECRET_ALERT_EMAIL = 'alerts.email';
const SECRET_ALERT_WEBHOOK = 'alerts.webhookUrl';
const SECRET_ALERT_ENABLED = 'alerts.enabled';

export interface AlertConfig {
  enabled: boolean;
  telegramToken: boolean;
  chatId: string | null;
  email: string | null;
  webhookUrl: string | null;
  channels: string[];
  configured: boolean;
}

export function readAlertConfig(): AlertConfig {
  const enabledRaw = getSecret(SECRET_ALERT_ENABLED);
  const enabled = enabledRaw === undefined ? true : enabledRaw === '1';
  const telegramToken = Boolean(getSecret(SECRET_TELEGRAM_TOKEN));
  const chatId = getSecret(SECRET_TELEGRAM_CHAT) ?? null;
  const email = getSecret(SECRET_ALERT_EMAIL) ?? null;
  const webhookUrl = getSecret(SECRET_ALERT_WEBHOOK) ?? null;
  const channels = [
    telegramToken && chatId ? 'telegram' : null,
    email ? 'email' : null,
    webhookUrl ? 'webhook' : null,
  ].filter(Boolean) as string[];
  return {
    enabled,
    telegramToken,
    chatId,
    email,
    webhookUrl,
    channels,
    configured: enabled && channels.length > 0,
  };
}

export function alertSecretStatus() {
  return secretStatus([
    SECRET_TELEGRAM_TOKEN,
    SECRET_TELEGRAM_CHAT,
    SECRET_ALERT_EMAIL,
    SECRET_ALERT_WEBHOOK,
    SECRET_ALERT_ENABLED,
  ]);
}

export function writeAlertConfig(input: {
  telegramBotToken?: string;
  telegramChatId?: string;
  email?: string;
  webhookUrl?: string;
  enabled?: boolean;
  userId?: string;
}) {
  if (input.telegramBotToken !== undefined) setSecret(SECRET_TELEGRAM_TOKEN, input.telegramBotToken, input.userId);
  if (input.telegramChatId !== undefined) setSecret(SECRET_TELEGRAM_CHAT, input.telegramChatId, input.userId);
  if (input.email !== undefined) setSecret(SECRET_ALERT_EMAIL, input.email, input.userId);
  if (input.webhookUrl !== undefined) setSecret(SECRET_ALERT_WEBHOOK, input.webhookUrl, input.userId);
  if (input.enabled !== undefined) setSecret(SECRET_ALERT_ENABLED, input.enabled ? '1' : '0', input.userId);
  return readAlertConfig();
}

/** Base URL for the Telegram API. Overridable so tests can point at a mock. */
function telegramBase(): string {
  return (process.env.ROYALWEB_TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
}

async function deliverTelegram(text: string): Promise<{ ok: boolean; detail: string }> {
  const token = getSecret(SECRET_TELEGRAM_TOKEN);
  const chatId = getSecret(SECRET_TELEGRAM_CHAT);
  if (!token || !chatId) return { ok: false, detail: 'Telegram is not configured' };
  const url = `${telegramBase()}/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || body.ok === false) {
      return { ok: false, detail: `Telegram rejected the message: HTTP ${res.status} ${body.description ?? ''}`.trim() };
    }
    return { ok: true, detail: 'Telegram accepted the message' };
  } catch (err) {
    return { ok: false, detail: `Telegram request failed: ${(err as Error).message}` };
  }
}

async function deliverWebhook(text: string, meta: Record<string, unknown>): Promise<{ ok: boolean; detail: string }> {
  const url = getSecret(SECRET_ALERT_WEBHOOK);
  if (!url) return { ok: false, detail: 'No webhook configured' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, detail: 'Webhook URL must be http(s)' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...meta, source: 'royalweb-autopilot', sentAt: nowIso() }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok
      ? { ok: true, detail: `Webhook accepted (HTTP ${res.status})` }
      : { ok: false, detail: `Webhook returned HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `Webhook request failed: ${(err as Error).message}` };
  }
}

async function deliverEmail(text: string, subject: string): Promise<{ ok: boolean; detail: string }> {
  const to = getSecret(SECRET_ALERT_EMAIL);
  if (!to) return { ok: false, detail: 'No alert email configured' };
  const owner = get<{ id: string }>("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
  if (!owner) return { ok: false, detail: 'No administrator account to attribute the alert email to' };
  try {
    const { sendEmail } = await import('@/lib/email/sender');
    const result = await sendEmail({
      userId: owner.id,
      to,
      subject,
      body: `${text}\n\n— ROYALWEB AUTOPILOT, ${new Date().toISOString()}`,
      template: 'custom',
    });
    return result.ok
      ? { ok: true, detail: 'Alert email handed to SMTP' }
      : { ok: false, detail: result.message };
  } catch (err) {
    return { ok: false, detail: `Alert email failed: ${(err as Error).message}` };
  }
}

export interface AlertResult {
  code: AlertCode;
  fired: boolean;
  suppressed?: string;
  channels: { channel: string; ok: boolean; detail: string }[];
  eventId?: string;
}

/**
 * Fire an alert. `dedupeMinutes` stops a broken worker from sending one message
 * per tick: the same code is silent inside the window, and the stored count is
 * incremented so the UI can show how long it has been going on.
 */
export async function raiseAlert(input: {
  code: AlertCode;
  title: string;
  detail: string;
  severity?: 'critical' | 'warning';
  workspaceId?: string | null;
  meta?: Record<string, unknown>;
  dedupeMinutes?: number;
  force?: boolean;
}): Promise<AlertResult> {
  const config = readAlertConfig();
  const dedupeMinutes = input.dedupeMinutes ?? 30;
  const stateKey = `${input.code}:${input.workspaceId ?? 'global'}`;
  const now = Date.now();

  const state = get<{ last_fired_at: string; count: number }>(
    'SELECT last_fired_at, count FROM alert_state WHERE key = ?',
    stateKey
  );
  if (!input.force && state?.last_fired_at && dedupeMinutes > 0) {
    const age = now - new Date(state.last_fired_at).getTime();
    if (age < dedupeMinutes * 60_000) {
      run('UPDATE alert_state SET count = count + 1 WHERE key = ?', stateKey);
      return {
        code: input.code,
        fired: false,
        suppressed: `Already alerted ${Math.round(age / 60000)}m ago — inside the ${dedupeMinutes}m cooldown.`,
        channels: [],
      };
    }
  }

  const eventId = newId();
  const text = `🚨 ${input.title}\n\n${input.detail}`;
  const channels: AlertResult['channels'] = [];

  if (config.enabled) {
    if (config.channels.includes('telegram')) {
      const r = await deliverTelegram(text);
      channels.push({ channel: 'telegram', ...r });
    }
    if (config.channels.includes('webhook')) {
      const r = await deliverWebhook(text, { code: input.code, severity: input.severity ?? 'critical' });
      channels.push({ channel: 'webhook', ...r });
    }
    if (config.channels.includes('email')) {
      const r = await deliverEmail(text, `[ROYALWEB] ${input.title}`);
      channels.push({ channel: 'email', ...r });
    }
  }

  const delivered = channels.some((c) => c.ok);
  const error = channels.filter((c) => !c.ok).map((c) => `${c.channel}: ${c.detail}`).join(' | ') || null;

  run(
    `INSERT INTO alert_events (id, workspace_id, code, severity, title, detail, meta_json, channel, delivered, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId,
    input.workspaceId ?? null,
    input.code,
    input.severity ?? 'critical',
    input.title.slice(0, 200),
    input.detail.slice(0, 2000),
    JSON.stringify({ ...(input.meta ?? {}), channels }),
    channels.map((c) => c.channel).join(',') || 'none',
    delivered ? 1 : 0,
    error,
    nowIso()
  );

  if (state) {
    run('UPDATE alert_state SET last_fired_at = ?, count = count + 1 WHERE key = ?', nowIso(), stateKey);
  } else {
    run('INSERT INTO alert_state (key, last_fired_at, count) VALUES (?, ?, 1)', stateKey, nowIso());
  }

  return { code: input.code, fired: true, channels, eventId };
}

export function listAlerts(limit = 25) {
  return all<Record<string, unknown>>(
    'SELECT * FROM alert_events ORDER BY created_at DESC LIMIT ?',
    limit
  ).map((r) => ({
    id: String(r.id),
    code: String(r.code),
    severity: String(r.severity),
    title: String(r.title),
    detail: String(r.detail),
    channel: String(r.channel),
    delivered: Boolean(Number(r.delivered ?? 0)),
    error: r.error ? String(r.error) : null,
    createdAt: String(r.created_at),
  }));
}
