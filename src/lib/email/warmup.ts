import 'server-only';
import { get, nowIso, run } from '@/lib/db';
import { decryptJson, encryptJson } from '@/lib/crypto';

/**
 * Email warm-up.
 *
 * A brand-new sending domain that immediately mails 200 people a day gets
 * throttled. The ramp starts small and grows: `start` on day one, `+increment`
 * per day, capped at `max`. The counter is per workspace, per day, and is
 * enforced before the SMTP call, so the limit is real rather than advisory.
 */

export interface WarmupSettings {
  workspaceId: string;
  rampEnabled: boolean;
  rampStart: number;
  rampIncrement: number;
  rampMax: number;
  rampStartedAt: string | null;
  imapEnabled: boolean;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  hasImapPassword: boolean;
  imapLastPollAt: string | null;
  imapLastError: string | null;
  smtp: {
    host: string;
    port: number;
    user: string;
    hasPassword: boolean;
    fromAddress: string;
    fromName: string;
    replyTo: string;
    postalAddress: string;
    unsubscribeUrl: string;
  };
}

export function ensureEmailSettings(workspaceId: string) {
  const existing = get<Record<string, unknown>>(
    'SELECT * FROM workspace_email_settings WHERE workspace_id = ?',
    workspaceId
  );
  if (existing) return existing;
  run(
    'INSERT INTO workspace_email_settings (workspace_id, updated_at) VALUES (?, ?) ON CONFLICT(workspace_id) DO NOTHING',
    workspaceId,
    nowIso()
  );
  return get<Record<string, unknown>>('SELECT * FROM workspace_email_settings WHERE workspace_id = ?', workspaceId)!;
}

export function readWarmup(workspaceId: string): WarmupSettings {
  const row = ensureEmailSettings(workspaceId);
  return {
    workspaceId,
    rampEnabled: Boolean(Number(row.ramp_enabled ?? 1)),
    rampStart: Number(row.ramp_start ?? 5),
    rampIncrement: Number(row.ramp_increment ?? 3),
    rampMax: Number(row.ramp_max ?? 50),
    rampStartedAt: row.ramp_started_at ? String(row.ramp_started_at) : null,
    imapEnabled: Boolean(Number(row.imap_enabled ?? 0)),
    imapHost: String(row.imap_host ?? ''),
    imapPort: Number(row.imap_port ?? 993),
    imapUser: String(row.imap_user ?? ''),
    hasImapPassword: Boolean(row.imap_pass_cipher),
    imapLastPollAt: row.imap_last_poll_at ? String(row.imap_last_poll_at) : null,
    imapLastError: row.imap_last_error ? String(row.imap_last_error) : null,
    smtp: {
      host: String(row.smtp_host ?? ''),
      port: Number(row.smtp_port ?? 0),
      user: String(row.smtp_user ?? ''),
      hasPassword: Boolean(row.smtp_pass_cipher),
      fromAddress: String(row.from_address ?? ''),
      fromName: String(row.from_name ?? ''),
      replyTo: String(row.reply_to ?? ''),
      postalAddress: String(row.postal_address ?? ''),
      unsubscribeUrl: String(row.unsubscribe_url ?? ''),
    },
  };
}

export function writeEmailIdentity(
  workspaceId: string,
  input: {
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    fromAddress?: string;
    fromName?: string;
    replyTo?: string;
    postalAddress?: string;
    unsubscribeUrl?: string;
    rampEnabled?: boolean;
    rampStart?: number;
    rampIncrement?: number;
    rampMax?: number;
    imapEnabled?: boolean;
    imapHost?: string;
    imapPort?: number;
    imapUser?: string;
    imapPass?: string;
  }
) {
  ensureEmailSettings(workspaceId);
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    assignments.push(`${column} = ?`);
    values.push(value);
  };
  if (input.host !== undefined) set('smtp_host', input.host.trim());
  if (input.port !== undefined) set('smtp_port', Number(input.port) || 587);
  if (input.user !== undefined) set('smtp_user', input.user.trim());
  if (input.pass) set('smtp_pass_cipher', encryptJson({ v: input.pass }));
  if (input.fromAddress !== undefined) set('from_address', input.fromAddress.trim());
  if (input.fromName !== undefined) set('from_name', input.fromName.trim());
  if (input.replyTo !== undefined) set('reply_to', input.replyTo.trim());
  if (input.postalAddress !== undefined) set('postal_address', input.postalAddress.trim());
  if (input.unsubscribeUrl !== undefined) set('unsubscribe_url', input.unsubscribeUrl.trim());
  if (input.rampEnabled !== undefined) set('ramp_enabled', input.rampEnabled ? 1 : 0);
  if (input.rampStart !== undefined) set('ramp_start', Math.max(1, Math.min(Number(input.rampStart) || 5, 500)));
  if (input.rampIncrement !== undefined)
    set('ramp_increment', Math.max(0, Math.min(Number(input.rampIncrement) || 3, 100)));
  if (input.rampMax !== undefined) set('ramp_max', Math.max(1, Math.min(Number(input.rampMax) || 50, 2000)));
  if (input.imapEnabled !== undefined) set('imap_enabled', input.imapEnabled ? 1 : 0);
  if (input.imapHost !== undefined) set('imap_host', input.imapHost.trim());
  if (input.imapPort !== undefined) set('imap_port', Number(input.imapPort) || 993);
  if (input.imapUser !== undefined) set('imap_user', input.imapUser.trim());
  if (input.imapPass) set('imap_pass_cipher', encryptJson({ v: input.imapPass }));
  assignments.push('updated_at = ?');
  values.push(nowIso());
  run(`UPDATE workspace_email_settings SET ${assignments.join(', ')} WHERE workspace_id = ?`, ...values, workspaceId);
  return readWarmup(workspaceId);
}

export function readEmailPassword(workspaceId: string): string | undefined {
  const row = get<{ smtp_pass_cipher: string }>(
    'SELECT smtp_pass_cipher FROM workspace_email_settings WHERE workspace_id = ?',
    workspaceId
  );
  if (!row?.smtp_pass_cipher) return undefined;
  try {
    return decryptJson<{ v: string }>(row.smtp_pass_cipher).v;
  } catch {
    return undefined;
  }
}

export function readImapPassword(workspaceId: string): string | undefined {
  const row = get<{ imap_pass_cipher: string }>(
    'SELECT imap_pass_cipher FROM workspace_email_settings WHERE workspace_id = ?',
    workspaceId
  );
  if (!row?.imap_pass_cipher) return undefined;
  try {
    return decryptJson<{ v: string }>(row.imap_pass_cipher).v;
  } catch {
    return undefined;
  }
}

/** Day-one limit grows by `increment` per elapsed day, never past `max`. */
export function dailyLimit(workspaceId: string): number {
  const settings = readWarmup(workspaceId);
  if (!settings.rampEnabled) return settings.rampMax;
  const started = settings.rampStartedAt ? new Date(settings.rampStartedAt).getTime() : null;
  if (!started) return settings.rampStart;
  const days = Math.max(0, Math.floor((Date.now() - started) / 86_400_000));
  return Math.min(settings.rampMax, settings.rampStart + days * settings.rampIncrement);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function sentToday(workspaceId: string): number {
  const row = get<{ sent: number }>(
    'SELECT sent FROM email_send_daily WHERE workspace_id = ? AND day = ?',
    workspaceId,
    today()
  );
  return Number(row?.sent ?? 0);
}

export function warmupStatus(workspaceId: string) {
  const settings = readWarmup(workspaceId);
  const limit = dailyLimit(workspaceId);
  const sent = sentToday(workspaceId);
  return {
    ...settings,
    dailyLimit: limit,
    sentToday: sent,
    remaining: Math.max(0, limit - sent),
    canSend: sent < limit,
    day: today(),
    note: settings.rampEnabled
      ? `Warm-up active: ${settings.rampStart}/day on day one, +${settings.rampIncrement}/day, capped at ${settings.rampMax}.`
      : 'Warm-up disabled — sending is limited only by the configured maximum.',
  };
}

/** Reserve one send slot. Returns null when the daily limit is reached. */
export function reserveSendSlot(workspaceId: string): { allowed: boolean; limit: number; sent: number } {
  if (!readWarmup(workspaceId).rampStartedAt) {
    run('UPDATE workspace_email_settings SET ramp_started_at = ? WHERE workspace_id = ?', nowIso(), workspaceId);
  }
  const limit = dailyLimit(workspaceId);
  const sent = sentToday(workspaceId);
  if (sent >= limit) return { allowed: false, limit, sent };
  run(
    `INSERT INTO email_send_daily (workspace_id, day, sent) VALUES (?, ?, 1)
     ON CONFLICT(workspace_id, day) DO UPDATE SET sent = sent + 1`,
    workspaceId,
    today()
  );
  return { allowed: true, limit, sent: sent + 1 };
}

export function releaseSendSlot(workspaceId: string) {
  run(
    'UPDATE email_send_daily SET sent = MAX(0, sent - 1) WHERE workspace_id = ? AND day = ?',
    workspaceId,
    today()
  );
}
