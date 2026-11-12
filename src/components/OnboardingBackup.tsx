'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileKey2,
  RefreshCw,
  Sparkles,
  Upload,
} from 'lucide-react';
import { api, Badge, Button, Card, CardHeader, Field, Input, Notice, Select, cn, useToast } from '@/components/ui';

interface EnvField {
  key: string;
  label: string;
  required: boolean;
  envVar: string | null;
  present: boolean;
  hint: string | null;
}

interface EnvAccount {
  platformId: string;
  platformName: string;
  accountName: string;
  source: 'json' | 'vars';
  ready: boolean;
  missingRequired: string[];
  tokenExpiresAt: string | null;
  fields: EnvField[];
}

interface BackupPayload {
  exportable: {
    secrets: number;
    secretKeys: string[];
    accounts: number;
    platforms: string[];
    unverifiedAccounts: number;
    suppressions: number;
  };
  lastExportAt: string | null;
  lastImportAt: string | null;
  lastSeed: { at: string; accounts: number; secrets: number; trigger: string } | null;
  env: {
    detected: boolean;
    disabled: boolean;
    secrets: { key: string; envVar: string; hint: string }[];
    readyCount: number;
    incompleteCount: number;
    accounts: EnvAccount[];
    runs: { at: string; trigger: string; secrets: number; accounts: number; skipped: { platformId: string; reason: string }[]; notes: string[] }[];
    jsonVar: string;
    seedingDisabled: boolean;
  };
  encryption: { atRest: string; backup: string };
}

interface ImportReport {
  mode: 'merge' | 'replace';
  restoredAt: string;
  backupCreatedAt: string | null;
  secrets: { imported: number; updated: number; keys: string[]; skipped: string[] };
  accounts: { created: number; updated: number; skipped: { platformId: string; accountName: string; reason: string }[] };
  suppressions: { added: number; alreadyPresent: number };
  warnings: string[];
}

function when(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Settings → Backup & onboarding.
 *
 * Two ways to avoid retyping 25 sets of credentials after a reset:
 *  1. an encrypted file you can restore anywhere (passphrase-sealed, never the
 *     server's own key), and
 *  2. .env.local pre-fill, which the app also runs automatically on first run.
 */
export function OnboardingBackup() {
  const { push } = useToast();
  const [data, setData] = useState<BackupPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // export
  const [passphrase, setPassphrase] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [exporting, setExporting] = useState(false);

  // import
  const [fileText, setFileText] = useState('');
  const [fileName, setFileName] = useState('');
  const [importPass, setImportPass] = useState('');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [replaceConfirm, setReplaceConfirm] = useState('');
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  // env seeding
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<BackupPayload>('/api/backup'));
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportBackup() {
    if (passphrase.length < 12) {
      push('Use a passphrase of at least 12 characters.', 'error');
      return;
    }
    if (passphrase !== confirmPass) {
      push('The two passphrases do not match.', 'error');
      return;
    }
    if (!acknowledged) {
      push('Confirm that you understand the file contains live credentials.', 'error');
      return;
    }
    setExporting(true);
    try {
      const res = await fetch('/api/backup/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-royalweb-request': '1' },
        body: JSON.stringify({ passphrase }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; detail?: unknown } | null;
        throw new Error(body?.error ?? `Export failed (HTTP ${res.status})`);
      }
      const text = await res.text();
      const disposition = res.headers.get('content-disposition') ?? '';
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'royalweb-backup.json';
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setPassphrase('');
      setConfirmPass('');
      setAcknowledged(false);
      push(`${name} downloaded — store it and the passphrase separately.`, 'success');
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  }

  async function pickFile(file: File | null) {
    if (!file) return;
    if (file.size > 4_000_000) {
      push('That file is larger than 4 MB — it is probably not a ROYALWEB backup.', 'error');
      return;
    }
    setFileName(file.name);
    setFileText(await file.text());
    setReport(null);
  }

  async function runImport() {
    if (!fileText) {
      push('Choose a backup file first.', 'error');
      return;
    }
    if (!importPass) {
      push('Enter the passphrase you used when exporting.', 'error');
      return;
    }
    if (mode === 'replace' && replaceConfirm.trim().toUpperCase() !== 'REPLACE') {
      push('Type REPLACE to confirm that current connections will be removed.', 'error');
      return;
    }
    setImporting(true);
    try {
      const result = await api<{ report: ImportReport }>('/api/backup/import', {
        method: 'POST',
        body: {
          file: fileText,
          passphrase: importPass,
          mode,
          confirmReplace: mode === 'replace',
        },
      });
      setReport(result.report);
      setImportPass('');
      setReplaceConfirm('');
      push(
        `Restored ${result.report.secrets.imported + result.report.secrets.updated} secret(s) and ${
          result.report.accounts.created + result.report.accounts.updated
        } account(s).`,
        'success'
      );
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setImporting(false);
    }
  }

  async function applyEnvSeed() {
    setSeeding(true);
    try {
      const result = await api<{
        applied: boolean;
        report?: { secrets: string[]; accounts: { platformName: string; accountName: string }[]; skipped: { platformId: string; reason: string }[]; notes: string[] };
        message?: string;
      }>('/api/backup/seed-env', { method: 'POST', body: { apply: true } });
      const r = result.report;
      setSeedMessage(
        r
          ? `${r.secrets.length} secret(s) and ${r.accounts.length} account(s) pre-filled. ${r.notes.join(' ')}`
          : result.message ?? 'Nothing to pre-fill.'
      );
      push('Pre-filled from .env.local — verification is still required.', 'success');
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setSeeding(false);
    }
  }

  if (loading || !data) {
    return <Card className="p-6 text-[12px] text-ink-400">Loading backup status…</Card>;
  }

  const { exportable, env } = data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Encrypted backup"
          subtitle="Everything you would otherwise retype: application secrets, OAuth client credentials, SMTP + sender identity, every connected platform account with its tokens, and the opt-out list."
          icon={<FileKey2 size={16} />}
        />
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Secrets" value={exportable.secrets} />
            <Stat label="Accounts" value={exportable.accounts} />
            <Stat label="Platforms" value={exportable.platforms.length} />
            <Stat label="Opt-outs" value={exportable.suppressions} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Passphrase" hint="12+ characters. Not stored anywhere — without it the file cannot be restored.">
              <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Repeat passphrase">
              <Input type="password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>

          <label className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-300">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 accent-[#d4af37]"
            />
            <span>
              I understand the downloaded file contains live credentials in encrypted form, and that anyone with the file
              <em> and</em> the passphrase has full access to these accounts.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="gold" onClick={exportBackup} loading={exporting} icon={<Download size={14} />}>
              Download encrypted backup
            </Button>
            <span className="text-[11px] text-ink-500">Last export: {when(data.lastExportAt)}</span>
          </div>

          <Notice tone="neutral" title="How it is protected">
            {data.encryption.backup}. The file is encrypted with a key derived from your passphrase, never with this
            server&apos;s master key — so it still opens after a reinstall or on another machine. Stored secrets stay{' '}
            {data.encryption.atRest}. Every export and import is recorded in the audit log by key name and count only;
            values are never logged.
          </Notice>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Restore from backup"
          subtitle="Choose the file you exported. Restored accounts are marked unverified until the platform confirms them — a backup cannot prove a token still works."
          icon={<Upload size={16} />}
        />
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Backup file" hint={fileName ? `Selected: ${fileName}` : 'royalweb-backup-….json'}>
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
                className="w-full cursor-pointer rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[12px] text-ink-300 file:mr-3 file:rounded-md file:border-0 file:bg-white/[0.06] file:px-2.5 file:py-1 file:text-[11px] file:text-ink-200"
              />
            </Field>
            <Field label="Passphrase">
              <Input type="password" value={importPass} onChange={(e) => setImportPass(e.target.value)} autoComplete="off" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mode">
              <Select value={mode} onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}>
                <option value="merge">Merge — add and update, keep everything else</option>
                <option value="replace">Replace — remove current connections first</option>
              </Select>
            </Field>
            {mode === 'replace' ? (
              <Field label="Type REPLACE to confirm" hint="This deletes this operator's connected accounts before restoring.">
                <Input value={replaceConfirm} onChange={(e) => setReplaceConfirm(e.target.value)} placeholder="REPLACE" />
              </Field>
            ) : (
              <div className="flex items-end pb-1">
                <p className="text-[11px] leading-relaxed text-ink-500">
                  Merge never deletes an account and never removes an opt-out. Secrets present in the backup overwrite the
                  stored value for the same key.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={runImport} loading={importing} icon={<Upload size={14} />}>
              Restore credentials
            </Button>
            <span className="text-[11px] text-ink-500">Last import: {when(data.lastImportAt)}</span>
          </div>

          {report ? (
            <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-200">
                <CheckCircle2 size={14} className="text-ok" />
                Restored {report.secrets.imported + report.secrets.updated} secret(s) ·{' '}
                {report.accounts.created + report.accounts.updated} account(s) · {report.suppressions.added} opt-out(s)
              </div>
              <div className="text-[11px] text-ink-400">
                Backup taken {when(report.backupCreatedAt)} · mode {report.mode}
              </div>
              {report.secrets.keys.length ? (
                <div className="text-[11px] leading-relaxed text-ink-400">
                  Keys: <span className="text-ink-300">{report.secrets.keys.join(', ')}</span>
                </div>
              ) : null}
              {report.accounts.skipped.length ? (
                <div className="text-[11px] text-warn">
                  Skipped: {report.accounts.skipped.map((s) => `${s.platformId} (${s.reason})`).join(', ')}
                </div>
              ) : null}
              {report.warnings.map((w) => (
                <div key={w} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-400">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
                  {w}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Pre-fill from .env.local"
          subtitle="On first run the app already imports these automatically. Re-run any time you add variables."
          icon={<Sparkles size={16} />}
        />
        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={env.detected ? 'green' : 'neutral'} dot>
              {env.detected ? 'variables detected' : 'nothing detected'}
            </Badge>
            <Badge tone="neutral">{env.secrets.length} secret(s)</Badge>
            <Badge tone={env.readyCount ? 'green' : 'neutral'}>{env.readyCount} account(s) ready</Badge>
            {env.incompleteCount ? <Badge tone="amber">{env.incompleteCount} incomplete</Badge> : null}
            {env.disabled ? <Badge tone="amber">disabled by ROYALWEB_DISABLE_ENV_SEED</Badge> : null}
          </div>

          {env.secrets.length ? (
            <div className="flex flex-wrap gap-1.5">
              {env.secrets.map((s) => (
                <span
                  key={s.key}
                  className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 font-mono text-[10.5px] text-ink-300"
                  title={`${s.key} → ${s.envVar}`}
                >
                  {s.envVar}
                  <span className="text-ink-500">{s.hint}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-ink-400">
              Set <code className="rounded bg-white/[0.05] px-1 text-gold-300">ROYALWEB_SMTP_*</code>,{' '}
              <code className="rounded bg-white/[0.05] px-1 text-gold-300">ROYALWEB_AI_API_KEY</code>,{' '}
              <code className="rounded bg-white/[0.05] px-1 text-gold-300">GOOGLE_CLIENT_ID</code> or{' '}
              <code className="rounded bg-white/[0.05] px-1 text-gold-300">{env.jsonVar}</code> in .env.local and restart.
              See <span className="text-ink-300">.env.example</span>.
            </p>
          )}

          {env.accounts.length ? (
            <div className="space-y-1.5">
              {env.accounts.map((a) => (
                <div
                  key={a.platformId}
                  className={cn(
                    'rounded-lg border px-3 py-2',
                    a.ready ? 'border-white/[0.07] bg-white/[0.02]' : 'border-warn/20 bg-warn/[0.04]'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12px] text-ink-200">
                      {a.platformName} <span className="text-ink-500">· {a.accountName}</span>
                    </span>
                    <Badge tone={a.ready ? 'green' : 'amber'}>{a.ready ? 'ready' : 'incomplete'}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-ink-500">
                    {a.fields
                      .filter((f) => f.present)
                      .map((f) => (
                        <span key={f.key}>
                          {f.envVar ?? f.label}
                          <span className="text-ink-600"> = {f.hint}</span>
                        </span>
                      ))}
                  </div>
                  {a.ready ? null : (
                    <div className="mt-1 text-[10.5px] text-warn">Missing: {a.missingRequired.join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={applyEnvSeed}
              loading={seeding}
              disabled={!env.detected || env.disabled}
              icon={<RefreshCw size={13} />}
            >
              Pre-fill now
            </Button>
            <span className="text-[11px] text-ink-500">
              Last run: {data.lastSeed ? `${when(data.lastSeed.at)} · ${data.lastSeed.accounts} account(s), ${data.lastSeed.secrets} secret(s)` : 'never'}
            </span>
          </div>

          {seedMessage ? <Notice tone="green">{seedMessage}</Notice> : null}

          {env.runs.length ? (
            <details className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
              <summary className="cursor-pointer text-[11px] text-ink-400">Pre-fill history</summary>
              <ul className="mt-2 space-y-1 text-[10.5px] text-ink-500">
                {env.runs.map((run) => (
                  <li key={run.at}>
                    {when(run.at)} · {run.trigger} · {run.secrets} secret(s) · {run.accounts} account(s)
                    {run.skipped.length ? ` · ${run.skipped.length} skipped` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <Notice tone="amber" title="Environment values win at runtime">
            If a variable is present, it overrides the stored copy — which is what you want during a rotate. Accounts
            created here are always <strong>unverified</strong>: run Diagnostics → “Verify accounts” (or press Verify on
            the Connections page) before publishing.
          </Notice>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-0.5 text-[16px] font-semibold text-ink-100">{value}</div>
    </div>
  );
}
