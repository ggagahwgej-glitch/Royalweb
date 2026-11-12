import 'server-only';
import { all, get, newId, nowIso, run } from '@/lib/db';
import { ADAPTERS, getAdapter } from '@/lib/platforms';
import { encryptJson } from '@/lib/crypto';
import { KNOWN_SECRET_KEYS, envVarFor, setSecret } from '@/lib/secrets';
import { activeWorkspace } from '@/lib/workspace';

/**
 * .env.local pre-seeding.
 *
 * Retyping the same 25 sets of credentials after every database reset is busy
 * work, so on first run the app reads what it already has in the environment:
 *
 *   ROYALWEB_SMTP_HOST / _PORT / _USER / _PASS, ROYALWEB_EMAIL_FROM, …
 *   ROYALWEB_AI_API_KEY, GOOGLE_CLIENT_ID / _SECRET, …
 *       → stored in app_secrets, encrypted at rest, showing up as configured.
 *
 *   ROYALWEB_CREDENTIALS='{"wordpress":{"siteUrl":"https://…","username":"…","appPassword":"…"}}'
 *       → one connected account per platform in that object.
 *
 *   ROYALWEB_WORDPRESS_SITE_URL / ROYALWEB_WORDPRESS_USERNAME / ROYALWEB_WORDPRESS_APP_PASSWORD
 *       → the same thing, one variable per credential field.
 *
 * Seeded accounts are always created as `unverified`. They are never presented
 * as connected and the publishing engine will not use them until a real
 * verification call succeeds — environment variables prove configuration, not
 * that the platform still accepts the token.
 */

export interface EnvAccountFieldPlan {
  key: string;
  label: string;
  required: boolean;
  envVar: string | null;
  present: boolean;
  /** Masked hint for the UI. The real value never leaves the server. */
  hint: string | null;
}

export interface EnvAccountPlan {
  platformId: string;
  platformName: string;
  accountName: string;
  source: 'json' | 'vars';
  fields: EnvAccountFieldPlan[];
  missingRequired: string[];
  ready: boolean;
  tokenExpiresAt: string | null;
  /** Internal only — stripped before the plan reaches the browser. */
  credentials: Record<string, string>;
}

export interface EnvSeedPlan {
  detected: boolean;
  disabled: boolean;
  secrets: { key: string; envVar: string; hint: string }[];
  accounts: EnvAccountPlan[];
  readyCount: number;
  incompleteCount: number;
}

const JSON_VARS = ['ROYALWEB_CREDENTIALS', 'ROYALWEB_PLATFORM_CREDENTIALS'];

function snake(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
}

/** Accepted env names for a credential field, most explicit first. */
export function envNamesFor(platformId: string, fieldKey: string): string[] {
  const platform = snake(platformId);
  const field = snake(fieldKey);
  return [
    `ROYALWEB_${platform}_${field}`,
    `ROYALWEB_${platform}_${field.replace(/_/g, '')}`,
  ];
}

export function accountNameEnvFor(platformId: string): string[] {
  const platform = snake(platformId);
  return [`ROYALWEB_${platform}_ACCOUNT_NAME`, `ROYALWEB_${platform}_NAME`];
}

function readJsonCredentials(): Record<string, unknown> {
  for (const name of JSON_VARS) {
    const raw = process.env[name];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      console.warn(`[env-seed] ${name} must be a JSON object of platformId → credentials`);
    } catch (err) {
      console.warn(`[env-seed] ${name} is not valid JSON: ${(err as Error).message}`);
    }
  }
  return {};
}

function maskHint(value: string): string {
  if (value.length <= 6) return '••••••';
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

function looksSecret(key: string): boolean {
  return /pass|secret|token|key|pin/i.test(key);
}

function deriveAccountName(platformId: string, credentials: Record<string, string>, fallback: string): string {
  const priority = ['siteUrl', 'host', 'handle', 'username', 'email', 'user', 'subdomain', 'blogId', 'boardId', 'pageId'];
  for (const key of priority) {
    const value = credentials[key];
    if (value) {
      try {
        return new URL(value).host.replace(/^www\./, '');
      } catch {
        return value.length > 120 ? value.slice(0, 120) : value;
      }
    }
  }
  return `${fallback} (from .env.local)`;
}

export function planEnvSeed(): EnvSeedPlan {
  const disabled = process.env.ROYALWEB_DISABLE_ENV_SEED === '1';
  const secrets: EnvSeedPlan['secrets'] = [];
  for (const key of KNOWN_SECRET_KEYS) {
    const envVar = envVarFor(key);
    if (!envVar) continue;
    const value = process.env[envVar];
    if (!value) continue;
    secrets.push({ key, envVar, hint: looksSecret(key) ? maskHint(value) : value });
  }

  const json = readJsonCredentials();
  const accounts: EnvAccountPlan[] = [];

  for (const adapter of ADAPTERS) {
    if (!adapter.credentialFields.length) continue;

    const jsonEntry = json[adapter.id];
    const fromJson =
      jsonEntry && typeof jsonEntry === 'object' && !Array.isArray(jsonEntry)
        ? (jsonEntry as Record<string, unknown>)
        : null;

    const credentials: Record<string, string> = {};
    const fields: EnvAccountFieldPlan[] = [];
    let usedEnv = false;

    for (const field of adapter.credentialFields) {
      let value = '';
      let envVar: string | null = null;
      const jsonValue = fromJson?.[field.key];
      if (typeof jsonValue === 'string' && jsonValue.trim()) {
        value = jsonValue.trim();
      } else {
        for (const name of envNamesFor(adapter.id, field.key)) {
          const candidate = process.env[name];
          if (candidate && candidate.trim()) {
            value = candidate.trim();
            envVar = name;
            usedEnv = true;
            break;
          }
        }
      }
      if (!value) {
        // Also accept a flat JSON entry that only carries some fields.
        fields.push({ key: field.key, label: field.label, required: field.required, envVar: null, present: false, hint: null });
        continue;
      }
      credentials[field.key] = value;
      fields.push({
        key: field.key,
        label: field.label,
        required: field.required,
        envVar,
        present: true,
        hint: field.type === 'password' || looksSecret(field.key) ? maskHint(value) : value,
      });
    }

    const detected = fields.some((f) => f.present);
    if (!detected) continue;

    const missingRequired = fields.filter((f) => f.required && !f.present).map((f) => f.label);

    let accountName = '';
    for (const name of accountNameEnvFor(adapter.id)) {
      if (process.env[name]?.trim()) {
        accountName = process.env[name]!.trim();
        break;
      }
    }
    if (!accountName) accountName = deriveAccountName(adapter.id, credentials, adapter.name);

    const expiryVar = `ROYALWEB_${snake(adapter.id)}_TOKEN_EXPIRES_AT`;
    const tokenExpiresAt = process.env[expiryVar]?.trim() || null;

    accounts.push({
      platformId: adapter.id,
      platformName: adapter.name,
      accountName: accountName.slice(0, 160),
      source: usedEnv ? 'vars' : 'json',
      fields,
      missingRequired,
      ready: missingRequired.length === 0,
      tokenExpiresAt,
      credentials,
    });
  }

  return {
    detected: secrets.length > 0 || accounts.length > 0,
    disabled,
    secrets,
    accounts,
    readyCount: accounts.filter((a) => a.ready).length,
    incompleteCount: accounts.filter((a) => !a.ready).length,
  };
}

/** What the Settings screen is allowed to see: names, presence, masked hints. */
export function publicEnvPlan(plan = planEnvSeed()) {
  return {
    detected: plan.detected,
    disabled: plan.disabled,
    secrets: plan.secrets,
    readyCount: plan.readyCount,
    incompleteCount: plan.incompleteCount,
    accounts: plan.accounts.map((a) => ({
      platformId: a.platformId,
      platformName: a.platformName,
      accountName: a.accountName,
      source: a.source,
      ready: a.ready,
      missingRequired: a.missingRequired,
      tokenExpiresAt: a.tokenExpiresAt,
      fields: a.fields,
    })),
  };
}

export interface EnvSeedReport {
  ranAt: string;
  trigger: 'first_run' | 'manual';
  secrets: string[];
  accounts: { platformId: string; platformName: string; accountName: string; status: string }[];
  skipped: { platformId: string; reason: string }[];
  notes: string[];
}

/**
 * Writes what .env.local provides into the encrypted store. Idempotent: a second
 * run updates the same rows instead of creating duplicates, and never
 * overwrites an account that already has live credentials for another name.
 */
export function runEnvSeed(userId: string, trigger: 'first_run' | 'manual' = 'manual'): EnvSeedReport {
  const plan = planEnvSeed();
  const report: EnvSeedReport = {
    ranAt: nowIso(),
    trigger,
    secrets: [],
    accounts: [],
    skipped: [],
    notes: [],
  };

  if (plan.disabled) {
    report.notes.push('Seeding is disabled by ROYALWEB_DISABLE_ENV_SEED=1.');
    return report;
  }

  for (const secret of plan.secrets) {
    const value = process.env[secret.envVar];
    if (!value) continue;
    const existing = get<{ value_cipher: string; source: string }>(
      'SELECT value_cipher, source FROM app_secrets WHERE key = ?',
      secret.key
    );
    setSecret(secret.key, value, userId, 'environment');
    report.secrets.push(secret.key);
    if (existing && existing.source === 'dashboard') {
      report.notes.push(`Overwrote a dashboard-entered value for ${secret.key} with the .env.local value (environment wins at runtime).`);
    }
  }

  for (const account of plan.accounts) {
    if (!account.ready) {
      report.skipped.push({ platformId: account.platformId, reason: `missing ${account.missingRequired.join(', ')}` });
      continue;
    }
    const adapter = getAdapter(account.platformId);
    if (!adapter) {
      report.skipped.push({ platformId: account.platformId, reason: 'unknown platform' });
      continue;
    }
    // The very first boot seeds accounts before anyone opens the dashboard, so
    // users.active_workspace_id may still be NULL. activeWorkspace() creates the
    // default workspace on demand — otherwise the account would be stored in the
    // NULL workspace, visible to every client.
    const workspaceId = activeWorkspace(userId).id;
    let seededName = account.accountName;
    const ownRow = get<{ id: string; status: string }>(
      'SELECT id, status FROM connected_accounts WHERE platform_id = ? AND account_name = ? AND workspace_id IS ?',
      account.platformId,
      seededName,
      workspaceId
    );
    if (!ownRow) {
      // The global UNIQUE(platform_id, account_name) means another workspace may
      // already hold this name. Seeding must add our own row, not overwrite theirs.
      const taken = get<{ id: string }>(
        'SELECT id FROM connected_accounts WHERE platform_id = ? AND account_name = ?',
        account.platformId,
        seededName
      );
      if (taken) {
        const label =
          get<{ name: string }>('SELECT name FROM workspaces WHERE id = ?', workspaceId ?? '')?.name?.trim() ||
          'workspace';
        let candidate = `${seededName} · ${label}`;
        let n = 2;
        while (
          get<{ id: string }>('SELECT id FROM connected_accounts WHERE platform_id = ? AND account_name = ?', account.platformId, candidate)
        ) {
          candidate = `${seededName} · ${label} ${n}`;
          n += 1;
        }
        seededName = candidate;
      }
    }
    const existing =
      ownRow ??
      get<{ id: string; status: string }>(
        'SELECT id, status FROM connected_accounts WHERE platform_id = ? AND account_name = ?',
        account.platformId,
        seededName
      );
    if (existing && existing.status === 'connected') {
      report.skipped.push({ platformId: account.platformId, reason: `already connected as ${account.accountName}` });
      continue;
    }
    const id = existing?.id ?? newId();
    // Credentials seeded for a user land in that user's active workspace, never
    // in the shared NULL workspace, so other clients cannot see them.
    run(
      `INSERT INTO connected_accounts (id, platform_id, user_id, workspace_id, account_name, external_id, credentials_cipher,
         scopes, token_expires_at, status, last_verified_at, last_error, meta_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'unverified', NULL, NULL, ?, ?, ?)
       ON CONFLICT(platform_id, account_name) DO UPDATE SET
         user_id = excluded.user_id,
         workspace_id = excluded.workspace_id,
         credentials_cipher = excluded.credentials_cipher,
         token_expires_at = excluded.token_expires_at,
         status = 'unverified',
         last_error = NULL,
         meta_json = excluded.meta_json,
         updated_at = excluded.updated_at`,
      id,
      account.platformId,
      userId,
      workspaceId,
      seededName,
      encryptJson(account.credentials),
      adapter.oauth?.scopes.join(' ') ?? '',
      account.tokenExpiresAt,
      JSON.stringify({
        seededFrom: 'env.local',
        seededAt: report.ranAt,
        envVars: account.fields.filter((f) => f.envVar).map((f) => f.envVar),
      }),
      nowIso(),
      nowIso()
    );
    run('UPDATE platforms SET credential_status = ? WHERE id = ?', 'unverified', account.platformId);
    report.accounts.push({
      platformId: account.platformId,
      platformName: account.platformName,
      accountName: account.accountName,
      status: 'unverified',
    });
  }

  if (report.accounts.length) {
    report.notes.push(
      `${report.accounts.length} account(s) were pre-filled and marked unverified. Press Verify once per account — the credentials are already stored, nothing needs retyping.`
    );
  }

  run(
    `INSERT INTO env_seed_runs (id, user_id, trigger, secrets, accounts, skipped_json, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    userId,
    trigger,
    report.secrets.length,
    report.accounts.length,
    JSON.stringify(report.skipped),
    JSON.stringify({ accounts: report.accounts, secrets: report.secrets, notes: report.notes }),
    report.ranAt
  );

  return report;
}

/** True when this installation has never been seeded, so first-run can do it. */
export function hasSeedRun(): boolean {
  return Boolean(get('SELECT 1 FROM env_seed_runs LIMIT 1'));
}

export function lastSeedRuns(limit = 5) {
  return all<{ created_at: string; trigger: string; secrets: number; accounts: number; skipped_json: string; detail_json: string }>(
    'SELECT created_at, trigger, secrets, accounts, skipped_json, detail_json FROM env_seed_runs ORDER BY created_at DESC LIMIT ?',
    limit
  ).map((r) => ({
    at: r.created_at,
    trigger: r.trigger,
    secrets: Number(r.secrets),
    accounts: Number(r.accounts),
    skipped: JSON.parse(r.skipped_json || '[]') as { platformId: string; reason: string }[],
    notes: (JSON.parse(r.detail_json || '{}') as { notes?: string[] }).notes ?? [],
  }));
}
