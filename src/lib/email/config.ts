import 'server-only';
import { getSecret, secretStatus } from '@/lib/secrets';
import { readWarmup } from './warmup';

/**
 * Outbound email configuration.
 *
 * ROYALWEB sends from an address *you* own and verify (your domain, Google
 * Workspace, Zoho, Fastmail, a transactional provider…). It deliberately does
 * not invent mailboxes, rotate senders or hide the sender's identity — that is
 * what makes mail land in spam, and it is what makes a business look like a
 * scammer.
 */

export interface EmailConfig {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  hasPassword: boolean;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  postalAddress: string;
  unsubscribeUrl: string;
  missing: string[];
}

const KEYS = [
  'email.smtpHost',
  'email.smtpPort',
  'email.smtpUser',
  'email.smtpPass',
  'email.fromAddress',
  'email.fromName',
  'email.replyTo',
  'email.postalAddress',
  'email.unsubscribeUrl',
] as const;

function withMissing(base: Omit<EmailConfig, 'configured' | 'missing' | 'secure'>): EmailConfig {
  const missing: string[] = [];
  if (!base.host) missing.push('SMTP host');
  if (!base.port) missing.push('SMTP port');
  if (!base.fromAddress) missing.push('From address');
  if (!base.user) missing.push('SMTP username');
  if (!base.hasPassword) missing.push('SMTP password');
  return {
    ...base,
    configured: missing.length === 0,
    secure: base.port === 465,
    missing,
  };
}

/**
 * The sender identity belongs to the *workspace*, so an agency can send as each
 * client from that client's own domain. When the workspace has no SMTP of its
 * own we fall back to the installation-level configuration (env or dashboard),
 * which is what a single-brand install keeps using.
 */
export function readEmailConfig(workspaceId?: string): EmailConfig {
  if (workspaceId) {
    const workspace = readWarmup(workspaceId).smtp;
    if (workspace.host) {
      return withMissing({
        host: workspace.host,
        port: workspace.port,
        user: workspace.user,
        hasPassword: workspace.hasPassword,
        fromAddress: workspace.fromAddress,
        fromName: workspace.fromName,
        replyTo: workspace.replyTo,
        postalAddress: workspace.postalAddress,
        unsubscribeUrl: workspace.unsubscribeUrl,
      });
    }
  }
  const host = getSecret('email.smtpHost') ?? '';
  const port = Number(getSecret('email.smtpPort') ?? 0) || 0;
  const user = getSecret('email.smtpUser') ?? '';
  const hasPassword = Boolean(getSecret('email.smtpPass'));
  const fromAddress = getSecret('email.fromAddress') ?? '';
  const fromName = getSecret('email.fromName') ?? '';
  const replyTo = getSecret('email.replyTo') ?? '';
  const postalAddress = getSecret('email.postalAddress') ?? '';
  const unsubscribeUrl = getSecret('email.unsubscribeUrl') ?? '';

  const missing: string[] = [];
  if (!host) missing.push('SMTP host');
  if (!port) missing.push('SMTP port');
  if (!fromAddress) missing.push('From address');
  if (!user) missing.push('SMTP username');
  if (!hasPassword) missing.push('SMTP password');

  return {
    configured: missing.length === 0,
    host,
    port,
    secure: port === 465,
    user,
    hasPassword,
    fromAddress,
    fromName,
    replyTo,
    postalAddress,
    unsubscribeUrl,
    missing,
  };
}

export function emailSecretStatus() {
  return secretStatus([...KEYS]);
}

/**
 * A deliverability warning set shown in the UI: things that are technically
 * optional but that separate "arrives in the inbox" from "marked as spam".
 */
export function deliverabilityAdvice(config: EmailConfig): { level: 'ok' | 'warn'; text: string }[] {
  const advice: { level: 'ok' | 'warn'; text: string }[] = [];
  advice.push({
    level: config.fromAddress && !/^(gmail|yahoo|outlook|hotmail)\./i.test(config.fromAddress.split('@')[1] ?? '')
      ? 'ok'
      : 'warn',
    text:
      config.fromAddress && !/^(gmail|yahoo|outlook|hotmail)\./i.test(config.fromAddress.split('@')[1] ?? '')
        ? 'Sending from your own domain — the strongest signal for inbox placement.'
        : 'Sending from a free mailbox (gmail/yahoo/outlook) hurts deliverability. Use an address on your own domain.',
  });
  advice.push({
    level: config.postalAddress ? 'ok' : 'warn',
    text: config.postalAddress
      ? 'Postal address is included in the footer (required for commercial email in most jurisdictions).'
      : 'Add a postal address — commercial email without one is a spam/compliance signal.',
  });
  advice.push({
    level: config.unsubscribeUrl ? 'ok' : 'warn',
    text: config.unsubscribeUrl
      ? 'Unsubscribe link configured and added to every footer.'
      : 'Add an unsubscribe URL — recipients need a one-click opt-out, and its absence is penalised.',
  });
  return advice;
}
