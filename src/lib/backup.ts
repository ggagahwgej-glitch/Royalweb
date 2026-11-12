import 'server-only';
import { all, get, newId, nowIso, run, tx } from '@/lib/db';
import { decryptJson, encryptJson, openWithPassphrase, sealWithPassphrase, type SealedDocument } from '@/lib/crypto';
import { exportableSecrets, KNOWN_SECRET_KEYS, setSecret } from '@/lib/secrets';
import { getAdapter } from '@/lib/platforms';

/**
 * Encrypted configuration backup.
 *
 * What leaves the machine: every resolvable application secret (AI key, OAuth
 * client IDs/secrets, SMTP + sender identity), every connected platform account
 * with its encrypted credential payload and OAuth tokens, and the permanent
 * opt-out list.
 *
 * What protects it: the file itself is a passphrase-sealed document
 * (scrypt → AES-256-GCM, header bound as AAD). The database master key is
 * deliberately *not* used — it is local to this installation, so a backup
 * encrypted with it could never be restored after a reinstall.
 *
 * What is deliberately different on restore: a restored account is never
 * claimed to be verified. Its live status is set to `unverified` so the first
 * publish attempt cannot silently use a token the platform has since revoked.
 */

export const BACKUP_FORMAT = 'royalweb-autopilot-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_FILE_PREFIX = 'royalweb-backup';

export interface BackupSecret {
  key: string;
  value: string;
  source: 'environment' | 'database';
}

export interface BackupAccount {
  platformId: string;
  accountName: string;
  externalId: string | null;
  credentials: Record<string, string>;
  scopes: string;
  tokenExpiresAt: string | null;
  status: string;
  lastVerifiedAt: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface BackupPayload {
  app: 'ROYALWEB AUTOPILOT';
  schema: number;
  createdAt: string;
  createdBy: string;
  secrets: BackupSecret[];
  accounts: BackupAccount[];
  suppressions: { email: string; reason: string; createdAt: string }[];
}

export interface BackupCounts {
  secrets: number;
  accounts: number;
  suppressions: number;
  platforms: string[];
}

export interface ImportReport {
  mode: 'merge' | 'replace';
  restoredAt: string;
  backupCreatedAt: string | null;
  secrets: { imported: number; updated: number; keys: string[]; skipped: string[] };
  accounts: {
    created: number;
    updated: number;
    skipped: { platformId: string; accountName: string; reason: string }[];
    platformIds: string[];
  };
  suppressions: { added: number; alreadyPresent: number };
  warnings: string[];
}

// ────────────────────────────────────────────────────────────── collection

export function backupCounts(payload: Pick<BackupPayload, 'secrets' | 'accounts' | 'suppressions'>): BackupCounts {
  return {
    secrets: payload.secrets.length,
    accounts: payload.accounts.length,
    suppressions: payload.suppressions.length,
    platforms: [...new Set(payload.accounts.map((a) => a.platformId))].sort(),
  };
}

export function collectBackup(userId: string, createdBy: string): BackupPayload {
  const warnings: string[] = [];
  const secrets: BackupSecret[] = exportableSecrets().map((s) => ({
    key: s.key,
    value: s.value,
    source: s.source,
  }));

  const rows = all<Record<string, unknown>>(
    `SELECT * FROM connected_accounts WHERE user_id = ? AND status != 'revoked' ORDER BY platform_id, created_at`,
    userId
  );
  const accounts: BackupAccount[] = [];
  for (const row of rows) {
    let credentials: Record<string, string> = {};
    try {
      credentials = decryptJson<Record<string, string>>(String(row.credentials_cipher));
    } catch {
      warnings.push(
        `${String(row.platform_id)} · ${String(row.account_name)} could not be decrypted with this master key and was left out of the backup.`
      );
      continue;
    }
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(String(row.meta_json ?? '{}')) as Record<string, unknown>;
    } catch {
      meta = {};
    }
    accounts.push({
      platformId: String(row.platform_id),
      accountName: String(row.account_name),
      externalId: row.external_id ? String(row.external_id) : null,
      credentials,
      scopes: String(row.scopes ?? ''),
      tokenExpiresAt: row.token_expires_at ? String(row.token_expires_at) : null,
      status: String(row.status ?? 'connected'),
      lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : null,
      meta,
      createdAt: String(row.created_at ?? nowIso()),
    });
  }

  const suppressions = all<{ email: string; reason: string; created_at: string }>(
    'SELECT email, reason, created_at FROM email_suppressions ORDER BY created_at'
  ).map((s) => ({ email: s.email, reason: s.reason, createdAt: s.created_at }));

  // `warnings` is surfaced by the caller; keep the payload pure.
  if (warnings.length) {
    console.warn('[backup] export warnings:', warnings.join(' | '));
  }

  return {
    app: 'ROYALWEB AUTOPILOT',
    schema: BACKUP_VERSION,
    createdAt: nowIso(),
    createdBy,
    secrets,
    accounts,
    suppressions,
  };
}

// ────────────────────────────────────────────────────────────── encryption

export function backupFileName(at = new Date()): string {
  const stamp = at.toISOString().replace(/[:]/g, '').slice(0, 15).replace('T', '-');
  return `${BACKUP_FILE_PREFIX}-${stamp}.json`;
}

export function sealBackup(payload: BackupPayload, passphrase: string): string {
  const counts = backupCounts(payload);
  const document = sealWithPassphrase(JSON.stringify(payload), passphrase, {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    meta: {
      app: payload.app,
      createdAt: payload.createdAt,
      createdBy: payload.createdBy,
      counts: { secrets: counts.secrets, accounts: counts.accounts, suppressions: counts.suppressions },
      platforms: counts.platforms,
      note: 'Encrypted with a passphrase (scrypt → AES-256-GCM). Keep the file and the passphrase separately.',
    },
  });
  return JSON.stringify(document, null, 2);
}

export function openBackupDocument(text: string, passphrase: string): { payload: BackupPayload; meta: Record<string, unknown> } {
  let document: SealedDocument;
  try {
    document = JSON.parse(text) as SealedDocument;
  } catch {
    throw new BackupError('bad_file', 'That file is not JSON. Choose a ROYALWEB backup file (.json).');
  }
  if (document?.format !== BACKUP_FORMAT) {
    throw new BackupError(
      'bad_format',
      `This is not a ROYALWEB backup file${document?.format ? ` (found “${String(document.format)}”)` : ''}.`
    );
  }
  if (Number(document.version) > BACKUP_VERSION) {
    throw new BackupError(
      'newer_version',
      `The backup was written by a newer version of ROYALWEB (schema ${String(document.version)}). Update the app first.`
    );
  }
  let plaintext: string;
  try {
    plaintext = openWithPassphrase(document, passphrase);
  } catch {
    // GCM failure. Never distinguish "wrong passphrase" from "file modified"
    // in a way that would help someone probing the file.
    throw new BackupError('bad_passphrase', 'Wrong passphrase, or the file has been modified since it was exported.');
  }
  let payload: BackupPayload;
  try {
    payload = JSON.parse(plaintext) as BackupPayload;
  } catch {
    throw new BackupError('bad_payload', 'The backup decrypted but its contents are unreadable.');
  }
  if (payload?.app !== 'ROYALWEB AUTOPILOT' || !Array.isArray(payload.secrets) || !Array.isArray(payload.accounts)) {
    throw new BackupError('bad_payload', 'The backup decrypted but does not contain ROYALWEB credentials.');
  }
  return { payload, meta: document.meta ?? {} };
}

export class BackupError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ────────────────────────────────────────────────────────────── import

const ALLOWED_STATUS = new Set(['connected', 'expired', 'error', 'unverified', 'revoked']);

/**
 * A restore never claims a live connection. Only a real verification call can
 * move an account to `connected`, which is what the publishing engine requires.
 */
function restoredStatus(stored: string): string {
  if (stored === 'error' || stored === 'expired') return stored;
  return 'unverified';
}

function cleanCredentials(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof k !== 'string' || !/^[A-Za-z0-9_.-]{1,60}$/.test(k)) return null;
    if (typeof v !== 'string') return null;
    if (v.length > 4000) return null;
    out[k] = v;
  }
  return out;
}

export function importBackup(options: {
  text: string;
  passphrase: string;
  mode: 'merge' | 'replace';
  userId: string;
}): ImportReport {
  const { payload } = openBackupDocument(options.text, options.passphrase);
  const warnings: string[] = [];
  const report: ImportReport = {
    mode: options.mode,
    restoredAt: nowIso(),
    backupCreatedAt: payload.createdAt ?? null,
    secrets: { imported: 0, updated: 0, keys: [], skipped: [] },
    accounts: { created: 0, updated: 0, skipped: [], platformIds: [] },
    suppressions: { added: 0, alreadyPresent: 0 },
    warnings,
  };

  const knownKeys = new Set(KNOWN_SECRET_KEYS);
  const affectedPlatforms = new Set<string>();

  tx(() => {
    if (options.mode === 'replace') {
      run('DELETE FROM connected_accounts WHERE user_id = ?', options.userId);
    }

    // ── secrets
    for (const entry of payload.secrets) {
      if (!entry || typeof entry.key !== 'string' || typeof entry.value !== 'string') {
        report.secrets.skipped.push('malformed entry');
        continue;
      }
      // Allowlist: a backup can only write keys the app itself knows about, so
      // a hand-edited file cannot inject arbitrary rows into app_secrets.
      if (!knownKeys.has(entry.key)) {
        report.secrets.skipped.push(entry.key);
        continue;
      }
      if (!entry.value || entry.value.length > 8000) {
        report.secrets.skipped.push(entry.key);
        continue;
      }
      const existing = get('SELECT 1 FROM app_secrets WHERE key = ?', entry.key);
      setSecret(entry.key, entry.value, options.userId, 'backup');
      if (existing) report.secrets.updated += 1;
      else report.secrets.imported += 1;
      report.secrets.keys.push(entry.key);
    }

    // ── connected accounts
    for (const account of payload.accounts) {
      const platformId = String(account?.platformId ?? '');
      const accountName = String(account?.accountName ?? '').trim();
      const adapter = getAdapter(platformId);
      if (!adapter) {
        report.accounts.skipped.push({ platformId, accountName, reason: 'unknown platform' });
        continue;
      }
      if (!accountName || accountName.length > 160) {
        report.accounts.skipped.push({ platformId, accountName, reason: 'invalid account name' });
        continue;
      }
      const credentials = cleanCredentials(account.credentials);
      if (!credentials || Object.keys(credentials).length === 0) {
        report.accounts.skipped.push({ platformId, accountName, reason: 'credentials unreadable' });
        continue;
      }
      const status = ALLOWED_STATUS.has(String(account.status)) ? restoredStatus(String(account.status)) : 'unverified';

      const existing = get<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM connected_accounts WHERE platform_id = ? AND account_name = ?',
        platformId,
        accountName
      );
      if (existing && existing.user_id !== options.userId) {
        // Never take an account away from another operator's row.
        report.accounts.skipped.push({ platformId, accountName, reason: 'owned by another user' });
        continue;
      }

      const id = existing?.id ?? newId();
      run(
        `INSERT INTO connected_accounts (id, platform_id, user_id, account_name, external_id, credentials_cipher,
           scopes, token_expires_at, status, last_verified_at, last_error, meta_json, created_at, updated_at,
           restored_from_backup)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(platform_id, account_name) DO UPDATE SET
           user_id = excluded.user_id,
           external_id = excluded.external_id,
           credentials_cipher = excluded.credentials_cipher,
           scopes = excluded.scopes,
           token_expires_at = excluded.token_expires_at,
           status = excluded.status,
           last_verified_at = excluded.last_verified_at,
           last_error = NULL,
           meta_json = excluded.meta_json,
           updated_at = excluded.updated_at,
           restored_from_backup = 1`,
        id,
        platformId,
        options.userId,
        accountName,
        account.externalId ? String(account.externalId).slice(0, 300) : null,
        encryptJson(credentials),
        String(account.scopes ?? '').slice(0, 500),
        account.tokenExpiresAt ? String(account.tokenExpiresAt) : null,
        status,
        account.lastVerifiedAt ? String(account.lastVerifiedAt) : null,
        null,
        JSON.stringify({ ...(account.meta ?? {}), restoredAt: report.restoredAt, restoredFromBackup: true }),
        existing ? nowIso() : String(account.createdAt ?? nowIso()),
        nowIso()
      );
      if (existing) report.accounts.updated += 1;
      else report.accounts.created += 1;
      affectedPlatforms.add(platformId);
    }

    // ── opt-outs (additive in both modes — a consent record is never dropped)
    for (const entry of payload.suppressions ?? []) {
      const email = String(entry?.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
      const existing = get('SELECT 1 FROM email_suppressions WHERE email = ?', email);
      if (existing) {
        report.suppressions.alreadyPresent += 1;
        continue;
      }
      run(
        'INSERT INTO email_suppressions (email, reason, created_at) VALUES (?, ?, ?)',
        email,
        String(entry?.reason ?? 'imported opt-out').slice(0, 200),
        String(entry?.createdAt ?? nowIso())
      );
      report.suppressions.added += 1;
    }

    // ── keep the platform catalogue's headline status honest
    for (const platformId of affectedPlatforms) {
      const rows = all<{ status: string }>('SELECT status FROM connected_accounts WHERE platform_id = ?', platformId);
      const anyConnected = rows.some((r) => r.status === 'connected');
      const anyRow = rows.length > 0;
      run(
        'UPDATE platforms SET credential_status = ? WHERE id = ?',
        anyConnected ? 'connected' : anyRow ? 'unverified' : 'not_connected',
        platformId
      );
    }
  });

  report.accounts.platformIds = [...affectedPlatforms].sort();

  const unverified = report.accounts.created + report.accounts.updated;
  if (unverified > 0) {
    report.warnings.push(
      `${unverified} account(s) were restored as “unverified”. Press Verify on each one (one click, no retyping) before publishing — a restore can never prove a token is still valid.`
    );
  }
  if (options.mode === 'replace' && report.accounts.created === 0 && payload.accounts.length === 0) {
    warnings.push('Replace mode removed this operator’s connected accounts and the backup contained none.');
  }
  if (payload.secrets.length === 0) {
    warnings.push('The backup contained no application secrets.');
  }

  return report;
}

/** Metadata for the Settings screen — counts only, never values. */
export function backupStatus(userId: string) {
  const accounts = all<{ platform_id: string; status: string }>(
    "SELECT platform_id, status FROM connected_accounts WHERE user_id = ? AND status != 'revoked'",
    userId
  );
  const secrets = exportableSecrets();
  const suppressions = get<{ c: number }>('SELECT COUNT(*) AS c FROM email_suppressions');
  const lastExport = get<{ created_at: string; meta_json: string }>(
    "SELECT created_at, meta_json FROM audit_logs WHERE action = 'backup.exported' ORDER BY created_at DESC LIMIT 1"
  );
  const lastImport = get<{ created_at: string; meta_json: string }>(
    "SELECT created_at, meta_json FROM audit_logs WHERE action = 'backup.imported' ORDER BY created_at DESC LIMIT 1"
  );
  const lastSeed = get<{ created_at: string; accounts: number; secrets: number; trigger: string }>(
    'SELECT created_at, accounts, secrets, trigger FROM env_seed_runs ORDER BY created_at DESC LIMIT 1'
  );
  return {
    exportable: {
      secrets: secrets.length,
      secretKeys: secrets.map((s) => s.key),
      accounts: accounts.length,
      platforms: [...new Set(accounts.map((a) => a.platform_id))].sort(),
      unverifiedAccounts: accounts.filter((a) => a.status === 'unverified').length,
      suppressions: Number(suppressions?.c ?? 0),
    },
    lastExportAt: lastExport?.created_at ?? null,
    lastImportAt: lastImport?.created_at ?? null,
    lastSeed: lastSeed
      ? { at: lastSeed.created_at, accounts: Number(lastSeed.accounts), secrets: Number(lastSeed.secrets), trigger: lastSeed.trigger }
      : null,
  };
}
