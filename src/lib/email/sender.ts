import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { all, get, newId, nowIso, run } from '@/lib/db';
import { getSecret } from '@/lib/secrets';
import { readEmailConfig } from './config';
import { readEmailPassword, releaseSendSlot, reserveSendSlot } from './warmup';
import { hasReplyFrom } from './imap';
import { toHtml } from './templates';

/**
 * Real SMTP sending.
 *
 * The status recorded is whatever the SMTP server accepted — "sent" means the
 * message was accepted for delivery, never merely "we tried". Failures are
 * stored with the transport error code so the operator can act on them.
 */

export interface SendInput {
  userId: string;
  /** When set, the workspace's own sender identity and warm-up limit apply. */
  workspaceId?: string;
  to: string;
  subject: string;
  body: string;
  template?: string;
  campaignId?: string | null;
  html?: string;
}

export interface SendResult {
  ok: boolean;
  status:
    | 'sent'
    | 'failed'
    | 'suppressed'
    | 'not_configured'
    | 'invalid_recipient'
    | 'daily_limit'
    | 'reply_paused';
  message: string;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
  errorCode?: string;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:]+@[^\s@<>()[\]\\,;:]+\.[A-Za-z]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function isSuppressed(email: string): { suppressed: boolean; reason?: string } {
  const row = get<{ reason: string }>(
    'SELECT reason FROM email_suppressions WHERE email = ?',
    email.trim().toLowerCase()
  );
  return row ? { suppressed: true, reason: row.reason } : { suppressed: false };
}

export function suppressEmail(email: string, reason = 'unsubscribed') {
  run(
    'INSERT INTO email_suppressions (email, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET reason = excluded.reason',
    email.trim().toLowerCase(),
    reason.slice(0, 200),
    nowIso()
  );
}

export function listEmailMessages(userId: string, workspaceId: string | null, limit = 40) {
  return all(
    `SELECT id, campaign_id, to_address, subject, body, template, status, error, message_id, created_at, sent_at
       FROM email_messages WHERE user_id = ?
         AND (workspace_id = ? OR (workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))
      ORDER BY created_at DESC LIMIT ?`,
    userId,
    workspaceId,
    workspaceId,
    userId,
    limit
  );
}

function classify(err: unknown): { code: string; message: string } {
  const e = err as { code?: string; response?: string; message?: string; command?: string };
  const raw = String(e?.response || e?.message || 'Unknown SMTP error');
  const code = e?.code || 'smtp_error';
  const map: Record<string, string> = {
    EAUTH: 'The mail server rejected the username/password. For Gmail/Workspace use an App Password, not your login password.',
    ECONNECTION: 'Could not connect to the SMTP host. Check the host, port and that outbound SMTP is allowed from this server.',
    ESOCKET: 'The connection dropped during the SMTP handshake. Often a TLS/port mismatch (465 = implicit TLS, 587 = STARTTLS).',
    ETIMEDOUT: 'The mail server did not answer in time.',
    EENVELOPE: 'The server rejected the sender or recipient address (envelope).',
    EDNS: 'The SMTP hostname could not be resolved.',
  };
  return { code, message: `${map[code] ?? 'SMTP error' } ${raw.slice(0, 300)}`.trim() };
}

function transport(workspaceId?: string) {
  const config = readEmailConfig(workspaceId);
  if (!config.configured) return { config, transporter: null as null | Transporter };
  const password = (workspaceId ? readEmailPassword(workspaceId) : undefined) ?? getSecret('email.smtpPass') ?? '';
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: password },
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return { config, transporter };
}

/** Live SMTP handshake + auth check. Never returns credentials. */
export async function verifyEmailConfig(workspaceId?: string): Promise<{ ok: boolean; message: string; code?: string }> {
  const { config, transporter } = transport(workspaceId);
  if (!config.configured || !transporter) {
    return { ok: false, message: `Email is not configured yet: ${config.missing.join(', ')}.` , code: 'not_configured' };
  }
  try {
    await transporter.verify();
    return { ok: true, message: `SMTP login succeeded for ${config.user} at ${config.host}:${config.port}.` };
  } catch (err) {
    const c = classify(err);
    return { ok: false, message: c.message, code: c.code };
  } finally {
    transporter.close();
  }
}

export async function sendEmail(input: SendInput): Promise<SendResult> {
  const to = input.to.trim();
  if (!isValidEmail(to)) {
    return { ok: false, status: 'invalid_recipient', message: `"${to}" is not a valid email address.` };
  }

  const suppression = isSuppressed(to);
  if (suppression.suppressed) {
    const message = `${to} is on the opt-out list (${suppression.reason}). Sending is blocked permanently.`;
    run(
      `INSERT INTO email_messages (id, user_id, workspace_id, campaign_id, to_address, subject, body, template, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suppressed', ?, ?)`,
      newId(),
      input.userId,
      input.workspaceId ?? null,
      input.campaignId ?? null,
      to,
      input.subject.slice(0, 300),
      input.body,
      input.template ?? 'custom',
      message,
      nowIso()
    );
    return { ok: false, status: 'suppressed', message };
  }

  // Reply detection: never keep pushing a follow-up at someone who answered.
  if (input.workspaceId && (input.template ?? 'custom') === 'follow_up' && hasReplyFrom(input.workspaceId, to)) {
    const message = `${to} has replied to this sequence. Follow-ups are paused automatically — answer them instead.`;
    run(
      `INSERT INTO email_messages (id, user_id, workspace_id, campaign_id, to_address, subject, body, template, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paused', ?, ?)`,
      newId(),
      input.userId,
      input.workspaceId,
      input.campaignId ?? null,
      to,
      input.subject.slice(0, 300),
      input.body,
      input.template ?? 'custom',
      message,
      nowIso()
    );
    return { ok: false, status: 'reply_paused', message };
  }

  // Warm-up: the daily limit is enforced here, before any SMTP work, and a slot
  // is only kept when the send is actually attempted.
  let reserved = false;
  if (input.workspaceId) {
    const slot = reserveSendSlot(input.workspaceId);
    if (!slot.allowed) {
      return {
        ok: false,
        status: 'daily_limit',
        message: `Daily sending limit reached (${slot.sent}/${slot.limit}) for this workspace. The warm-up schedule raises it automatically tomorrow, or adjust it in Settings → Email.`,
      };
    }
    reserved = true;
  }

  const { config, transporter } = transport(input.workspaceId);
  if (!config.configured || !transporter) {
    if (reserved && input.workspaceId) releaseSendSlot(input.workspaceId);
    return {
      ok: false,
      status: 'not_configured',
      message: `Email is not configured: ${config.missing.join(', ')}. Add SMTP details in Settings → Email.`,
    };
  }

  const id = newId();
  run(
    `INSERT INTO email_messages (id, user_id, workspace_id, campaign_id, to_address, subject, body, template, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    id,
    input.userId,
    input.workspaceId ?? null,
    input.campaignId ?? null,
    to,
    input.subject.slice(0, 300),
    input.body,
    input.template ?? 'custom',
    nowIso()
  );

  const headers: Record<string, string> = {
    'X-Mailer': 'ROYALWEB AUTOPILOT',
    'Auto-Submitted': 'auto-generated',
  };
  if (config.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${config.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  try {
    const info = await transporter.sendMail({
      from: config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress,
      to,
      replyTo: config.replyTo || config.fromAddress,
      subject: input.subject.slice(0, 200),
      text: input.body,
      html: input.html ?? toHtml(input.body),
      headers,
    });
    const accepted = (info.accepted ?? []).map(String);
    const rejected = (info.rejected ?? []).map(String);
    const delivered = rejected.length === 0 && (accepted.length > 0 || !to);
    run(
      `UPDATE email_messages SET status = ?, error = NULL, message_id = ?, accepted_json = ?, rejected_json = ?,
         sent_at = ? WHERE id = ?`,
      delivered ? 'sent' : 'failed',
      info.messageId ?? null,
      JSON.stringify(accepted),
      JSON.stringify(rejected),
      nowIso(),
      id
    );
    if (!delivered) {
      return {
        ok: false,
        status: 'failed',
        message: `The mail server accepted the message but rejected ${rejected.join(', ') || 'the recipient'}.`,
        messageId: info.messageId,
        accepted,
        rejected,
      };
    }
    return {
      ok: true,
      status: 'sent',
      message: `Accepted by ${config.host} for delivery to ${to}. Delivery to the inbox is up to the recipient's provider.`,
      messageId: info.messageId,
      accepted,
      rejected,
    };
  } catch (err) {
    const c = classify(err);
    if (reserved && input.workspaceId) releaseSendSlot(input.workspaceId);
    run(
      'UPDATE email_messages SET status = ?, error = ? WHERE id = ?',
      'failed',
      `${c.code}: ${c.message}`.slice(0, 1000),
      id
    );
    return { ok: false, status: 'failed', message: c.message, errorCode: c.code };
  } finally {
    transporter.close();
  }
}
