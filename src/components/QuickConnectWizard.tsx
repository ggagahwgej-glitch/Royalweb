'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ClipboardPaste,
  ExternalLink,
  Mail,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { api, Badge, Button, Card, Field, Input, Notice, cn, useToast } from '@/components/ui';
import { PlatformMark } from '@/components/PlatformMark';

export interface WizardField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface WizardPlatform {
  id: string;
  name: string;
  group: string;
  automation: string;
  integration: string;
  oauthRequired: boolean;
  oauthConfigured: boolean;
  credentialFields: WizardField[];
  connectInstructions: string;
  tier: 'quick' | 'oauth' | 'manual';
  tierLabel: string;
  quickConnect: { keyUrl: string; keyLabel: string; micro: string; minutes: number } | null;
}

export interface WizardAccount {
  id: string;
  platformId: string;
  accountName: string;
  status: string;
}

type TierFilter = 'quick' | 'oauth' | 'manual' | 'all';

interface RowResult {
  status: 'connected' | 'skipped' | 'invalid' | 'failed';
  detail?: string;
  accountName?: string | null;
}

const TIERS: { id: TierFilter; label: string; hint: string }[] = [
  { id: 'quick', label: 'Fastest to connect', hint: '3–5 minutes each · no approval' },
  { id: 'oauth', label: 'OAuth / approval', hint: 'Needs an app or platform approval' },
  { id: 'manual', label: 'Manual', hint: 'No key — copy is prepared for you' },
  { id: 'all', label: 'All 25', hint: 'Everything in one grid' },
];

export function QuickConnectWizard({
  platforms,
  accounts,
  onConnected,
}: {
  platforms: WizardPlatform[];
  accounts: WizardAccount[];
  onConnected: () => Promise<void> | void;
}) {
  const { push } = useToast();
  const [tier, setTier] = useState<TierFilter>('quick');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const connectedByPlatform = useMemo(() => {
    const map: Record<string, WizardAccount | undefined> = {};
    for (const a of accounts) if (!map[a.platformId]) map[a.platformId] = a;
    return map;
  }, [accounts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return platforms
      .filter((p) => (tier === 'all' ? true : p.tier === tier))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) || p.integration.toLowerCase().includes(q) : true));
  }, [platforms, tier, query]);

  const filledCount = useMemo(
    () =>
      platforms.filter((p) =>
        Object.values(values[p.id] ?? {}).some((v) => typeof v === 'string' && v.trim().length > 0)
      ).length,
    [platforms, values]
  );

  const setValue = useCallback((platformId: string, key: string, value: string) => {
    setValues((prev) => ({ ...prev, [platformId]: { ...(prev[platformId] ?? {}), [key]: value } }));
    setResults((prev) => {
      if (!prev[platformId]) return prev;
      const next = { ...prev };
      delete next[platformId];
      return next;
    });
  }, []);

  async function pasteInto(platformId: string, key: string) {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        push('Your clipboard is empty.', 'info');
        return;
      }
      setValue(platformId, key, text.trim().split('\n')[0].trim());
    } catch {
      // Browsers gate clipboard reads; focus the field so Ctrl/Cmd+V works.
      const el = document.getElementById(`qc-${platformId}-${key}`) as HTMLInputElement | null;
      el?.focus();
      push('Clipboard access is blocked by the browser — press Ctrl/Cmd+V in the field.', 'info');
    }
  }

  function payload(platformId: string) {
    const adapter = platforms.find((p) => p.id === platformId);
    const raw = values[platformId] ?? {};
    const credentials: Record<string, string> = {};
    for (const f of adapter?.credentialFields ?? []) {
      if (f.key === 'accountName') continue;
      if (raw[f.key]?.trim()) credentials[f.key] = raw[f.key].trim();
    }
    // `accountName` is a label, not a credential — sending it inside the
    // credentials object would encrypt junk next to the real secret.
    return { platformId, accountName: raw.accountName?.trim() || undefined, credentials };
  }

  async function saveOne(platformId: string) {
    setBusy(`row:${platformId}`);
    try {
      const data = await api<{ summary: { connected: number; failed: number; skipped: number }; results: (RowResult & { platformId: string })[] }>(
        '/api/accounts/bulk',
        { method: 'POST', body: { entries: [payload(platformId)] } }
      );
      const r = data.results[0];
      setResults((prev) => ({ ...prev, [platformId]: r }));
      if (r?.status === 'connected') {
        push(`${platforms.find((p) => p.id === platformId)?.name ?? platformId} connected and verified`, 'success');
        setValues((prev) => ({ ...prev, [platformId]: {} }));
        await onConnected();
      } else {
        push(r?.detail ?? 'Verification failed', 'error');
      }
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function saveAll() {
    const entries = platforms
      .map((p) => payload(p.id))
      .filter((e) => Object.keys(e.credentials).length > 0 || Boolean(e.accountName));
    if (entries.length === 0) {
      push('Paste at least one key first.', 'info');
      return;
    }
    setBusy('all');
    try {
      const data = await api<{
        summary: { attempted: number; connected: number; failed: number; skipped: number };
        results: (RowResult & { platformId: string; platformName?: string })[];
      }>('/api/accounts/bulk', { method: 'POST', body: { entries } });

      const next: Record<string, RowResult> = { ...results };
      for (const r of data.results) next[r.platformId] = r;
      setResults(next);

      const { connected, failed, skipped } = data.summary;
      const parts = [
        `${connected} connected`,
        failed ? `${failed} failed` : null,
        skipped ? `${skipped} skipped` : null,
      ].filter(Boolean);
      push(`Save & verify: ${parts.join(' · ')}`, connected > 0 ? 'success' : 'error');

      // Keep only the failed rows populated so the grid holds exactly what needs fixing.
      setValues((prev) => {
        const kept: Record<string, Record<string, string>> = {};
        for (const r of data.results) {
          if (r.status !== 'connected' && prev[r.platformId]) kept[r.platformId] = prev[r.platformId];
        }
        return kept;
      });
      await onConnected();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink-100">
            <Sparkles size={15} className="text-gold-400" />
            Quick-connect wizard
          </div>
          <p className="mt-0.5 max-w-2xl text-[11.5px] leading-relaxed text-ink-400">
            Open the exact page that issues each key, copy it, paste it here, and verify everything in one action.
            Start with one or two platforms — the rest can stay empty without warnings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="gold"
            size="sm"
            loading={busy === 'all'}
            disabled={filledCount === 0}
            onClick={() => void saveAll()}
            icon={<Check size={13} />}
          >
            Save &amp; verify all{filledCount ? ` (${filledCount})` : ''}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
        {TIERS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTier(t.id)}
            title={t.hint}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-[11px] transition-colors',
              tier === t.id
                ? 'border-gold-500/40 bg-gold-500/10 text-gold-200'
                : 'border-white/[0.07] text-ink-400 hover:text-ink-200'
            )}
          >
            {t.label}
            <span className="ml-1.5 text-[10px] text-ink-500">
              {t.id === 'all' ? platforms.length : platforms.filter((p) => p.tier === t.id).length}
            </span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2 py-1">
          <Search size={11} className="text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter platforms"
            className="w-36 bg-transparent text-[11px] text-ink-200 outline-none placeholder:text-ink-600"
          />
        </div>
      </div>

      <div className="divide-y divide-white/[0.05]">
        {visible.map((p) => {
          const account = connectedByPlatform[p.id];
          const result = results[p.id];
          const isOpen = open[p.id] ?? false;
          const current = values[p.id] ?? {};
          const hasInput = Object.values(current).some((v) => v.trim());
          const credentialFields = p.credentialFields.filter((f) => f.key !== 'accountName');
          const canPaste = !p.oauthRequired && credentialFields.length > 0;

          return (
            <div key={p.id}>
              <button
                onClick={() => setOpen((prev) => ({ ...prev, [p.id]: !isOpen }))}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-white/[0.02]"
                aria-expanded={isOpen}
              >
                <PlatformMark id={p.id} name={p.name} size="sm" className="h-6 w-6 text-[9px]" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12.5px] text-ink-100">{p.name}</span>
                    {account ? (
                      <Badge tone={account.status === 'connected' ? 'green' : 'amber'} dot>
                        {account.status === 'connected' ? 'connected' : account.status}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">not connected</Badge>
                    )}
                    {hasInput ? <Badge tone="gold">{Object.values(current).filter((v) => v.trim()).length} filled</Badge> : null}
                    {result && result.status !== 'connected' ? <Badge tone="red">needs attention</Badge> : null}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-ink-500">
                    <span>{p.integration}</span>
                    {p.quickConnect ? <span>· ~{p.quickConnect.minutes} min</span> : null}
                    {p.oauthRequired ? <span>· OAuth app {p.oauthConfigured ? 'configured' : 'not configured'}</span> : null}
                  </span>
                </span>
                <ChevronDown size={14} className={cn('shrink-0 text-ink-500 transition-transform', isOpen && 'rotate-180')} />
              </button>

              {isOpen ? (
                <div className="space-y-3 bg-white/[0.012] px-4 pb-4 pt-1">
                  {p.quickConnect ? (
                    <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                      <p className="max-w-xl text-[11.5px] leading-relaxed text-ink-300">{p.quickConnect.micro}</p>
                      <a
                        href={p.quickConnect.keyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gold-500/30 bg-gold-500/[0.08] px-2 py-1 text-[11px] text-gold-200 hover:bg-gold-500/[0.14]"
                      >
                        {p.quickConnect.keyLabel}
                        <ArrowUpRight size={11} />
                      </a>
                    </div>
                  ) : null}

                  {p.oauthRequired && credentialFields.length === 0 ? (
                    <Notice tone="neutral">
                      This platform needs an OAuth app (Client ID/Secret) configured once in{' '}
                      <a href="/dashboard/settings" className="text-gold-300 hover:underline">
                        Settings → Integrations
                      </a>
                      , then press Connect there. Nothing to paste here.
                    </Notice>
                  ) : credentialFields.length === 0 ? (
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <Field label="Profile / listing URL" hint="Used for reference and manual packages.">
                        <div className="flex gap-1.5">
                          <Input
                            id={`qc-${p.id}-accountName`}
                            value={current.accountName ?? ''}
                            onChange={(e) => setValue(p.id, 'accountName', e.target.value)}
                            placeholder="https://…"
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void pasteInto(p.id, 'accountName')}
                            icon={<ClipboardPaste size={11} />}
                            title="Paste from clipboard"
                          >
                            Paste
                          </Button>
                        </div>
                      </Field>
                      <div className="flex items-end">
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busy === `row:${p.id}`}
                          disabled={!current.accountName?.trim()}
                          onClick={() => void saveOne(p.id)}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {credentialFields.map((f) => (
                        <Field key={f.key} label={f.label} hint={f.help}>
                          <div className="flex gap-1.5">
                            <Input
                              id={`qc-${p.id}-${f.key}`}
                              type={f.type === 'password' ? 'password' : 'text'}
                              value={current[f.key] ?? ''}
                              onChange={(e) => setValue(p.id, f.key, e.target.value)}
                              placeholder={f.placeholder ?? ''}
                              autoComplete="off"
                              spellCheck={false}
                            />
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void pasteInto(p.id, f.key)}
                              icon={<ClipboardPaste size={11} />}
                              title={`Paste ${f.label} from clipboard`}
                              aria-label={`Paste ${f.label} from clipboard`}
                            >
                              Paste
                            </Button>
                          </div>
                        </Field>
                      ))}
                    </div>
                  )}

                  {credentialFields.length > 0 && !p.oauthRequired ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="gold"
                        loading={busy === `row:${p.id}`}
                        disabled={!canPaste || !hasInput}
                        onClick={() => void saveOne(p.id)}
                        icon={<Check size={12} />}
                      >
                        Save &amp; verify
                      </Button>
                      <span className="text-[10.5px] text-ink-500">
                        Verified against {p.name} before it is stored; encrypted with AES-256-GCM.
                      </span>
                    </div>
                  ) : null}

                  {account ? (
                    <p className="text-[10.5px] text-ink-500">
                      Currently connected as <span className="text-ink-300">{account.accountName}</span>. Saving again
                      replaces the stored credential after it verifies.
                    </p>
                  ) : null}

                  {result && result.status !== 'connected' ? (
                    <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-[11px] text-danger/90">
                      <X size={12} className="mt-0.5 shrink-0" />
                      <span>{result.detail ?? 'Not saved.'}</span>
                    </div>
                  ) : null}
                  {result?.status === 'connected' ? (
                    <div className="flex items-center gap-2 rounded-lg border border-ok/25 bg-ok/[0.06] px-3 py-2 text-[11px] text-ok">
                      <Check size={12} /> Connected and verified{result.accountName ? ` as ${result.accountName}` : ''}.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {tier === 'quick' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] bg-white/[0.015] px-4 py-3">
          <div className="flex items-start gap-2">
            <Mail size={13} className="mt-0.5 text-gold-400" />
            <div>
              <div className="text-[11.5px] text-ink-200">Email is a sender identity, not a platform</div>
              <p className="text-[10.5px] text-ink-500">
                Add your SMTP host, address and app password once — it powers outreach, alerts and reply detection.
              </p>
            </div>
          </div>
          <a
            href="/dashboard/settings"
            className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-ink-300 hover:bg-white/[0.04]"
          >
            Open Settings → Email
            <ExternalLink size={10} />
          </a>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11.5px] text-ink-500">No platforms match this filter.</div>
      ) : null}
    </Card>
  );
}
