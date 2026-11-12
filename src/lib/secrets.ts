import 'server-only';
import { get, run, nowIso } from '@/lib/db';
import { encryptJson, decryptJson } from '@/lib/crypto';

/**
 * Application secrets (AI API keys, OAuth client secrets).
 * Stored encrypted in the database, or read from environment variables.
 * Values are NEVER sent to the browser — the API only exposes a masked hint.
 */

export type SecretKey =
  | 'ai.apiKey'
  | 'oauth.google.clientId'
  | 'oauth.google.clientSecret'
  | 'oauth.pinterest.clientId'
  | 'oauth.pinterest.clientSecret'
  | 'oauth.linkedin.clientId'
  | 'oauth.linkedin.clientSecret'
  | 'oauth.x.clientId'
  | 'oauth.x.clientSecret'
  | 'oauth.slack.clientId'
  | 'oauth.slack.clientSecret'
  | 'oauth.tumblr.clientId'
  | 'oauth.tumblr.clientSecret'
  | 'ai.baseUrl'
  | 'email.smtpHost'
  | 'email.smtpPort'
  | 'email.smtpUser'
  | 'email.smtpPass'
  | 'email.fromAddress'
  | 'email.fromName'
  | 'email.replyTo'
  | 'email.postalAddress'
  | 'email.unsubscribeUrl';

const ENV_MAP: Record<string, string> = {
  'ai.apiKey': 'ROYALWEB_AI_API_KEY',
  'ai.baseUrl': 'ROYALWEB_AI_BASE_URL',
  'email.smtpHost': 'ROYALWEB_SMTP_HOST',
  'email.smtpPort': 'ROYALWEB_SMTP_PORT',
  'email.smtpUser': 'ROYALWEB_SMTP_USER',
  'email.smtpPass': 'ROYALWEB_SMTP_PASS',
  'email.fromAddress': 'ROYALWEB_EMAIL_FROM',
  'email.fromName': 'ROYALWEB_EMAIL_FROM_NAME',
  'email.replyTo': 'ROYALWEB_EMAIL_REPLY_TO',
  'email.postalAddress': 'ROYALWEB_EMAIL_POSTAL_ADDRESS',
  'email.unsubscribeUrl': 'ROYALWEB_EMAIL_UNSUBSCRIBE_URL',
  'oauth.google.clientId': 'GOOGLE_CLIENT_ID',
  'oauth.google.clientSecret': 'GOOGLE_CLIENT_SECRET',
  'oauth.pinterest.clientId': 'PINTEREST_CLIENT_ID',
  'oauth.pinterest.clientSecret': 'PINTEREST_CLIENT_SECRET',
  'oauth.linkedin.clientId': 'LINKEDIN_CLIENT_ID',
  'oauth.linkedin.clientSecret': 'LINKEDIN_CLIENT_SECRET',
  'oauth.x.clientId': 'X_CLIENT_ID',
  'oauth.x.clientSecret': 'X_CLIENT_SECRET',
  'oauth.slack.clientId': 'SLACK_CLIENT_ID',
  'oauth.slack.clientSecret': 'SLACK_CLIENT_SECRET',
  'oauth.tumblr.clientId': 'TUMBLR_CLIENT_ID',
  'oauth.tumblr.clientSecret': 'TUMBLR_CLIENT_SECRET',
};

export function getSecret(key: SecretKey | string): string | undefined {
  const envName = ENV_MAP[key];
  if (envName && process.env[envName]) return process.env[envName];
  const row = get<{ value_cipher: string }>('SELECT value_cipher FROM app_secrets WHERE key = ?', key);
  if (!row) return undefined;
  try {
    return decryptJson<{ v: string }>(row.value_cipher).v;
  } catch {
    return undefined;
  }
}

export function setSecret(key: SecretKey | string, value: string, userId?: string) {
  if (!value) {
    run('DELETE FROM app_secrets WHERE key = ?', key);
    return;
  }
  run(
    `INSERT INTO app_secrets (key, value_cipher, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_cipher = excluded.value_cipher, updated_at = excluded.updated_at`,
    key,
    encryptJson({ v: value }),
    nowIso()
  );
  void userId;
}

export function hasEnvSecret(key: string): boolean {
  const envName = ENV_MAP[key];
  return Boolean(envName && process.env[envName]);
}

/** Safe metadata for the settings UI — never the secret itself. */
export function secretStatus(keys: string[]) {
  return keys.map((key) => {
    const fromEnv = hasEnvSecret(key);
    const stored = Boolean(get('SELECT 1 FROM app_secrets WHERE key = ?', key));
    return { key, configured: fromEnv || stored, source: fromEnv ? 'environment' : stored ? 'database' : 'none' };
  });
}
