'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ExternalLink, KeyRound, Plug, ShieldAlert } from 'lucide-react';
import {
  api,
  Badge,
  Button,
  Card,
  Notice,
  PageHeader,
  Spinner,
  StatusBadge,
  Switch,
  cn,
  useToast,
} from '@/components/ui';
import { PlatformMark } from '@/components/PlatformMark';
import { relativeTime } from '@/lib/time';

interface Platform {
  id: string;
  number: number;
  name: string;
  group: 'A' | 'B' | 'C';
  automation: 'automatic' | 'approval' | 'manual';
  integration: string;
  docsUrl: string;
  enabled: boolean;
  accountCount: number;
  publishedCount: number;
  failedCount: number;
  scheduledCount: number;
  lastActivityAt: string | null;
  lastError: string | null;
  notes: string;
  connectInstructions: string;
  permissionNotes: string;
  automationLabel: string;
  status: string;
  oauthRequired: boolean;
  oauthConfigured: boolean;
  credentialFields: { key: string; label: string; type: string; required: boolean; help?: string }[];
  capabilities: { text: boolean; image: boolean; video: boolean; article: boolean; imageViaUrl?: boolean };
  rendererAvailable: boolean | null;
  manualUrl: string | null;
}

const GROUPS: { key: 'A' | 'B' | 'C'; title: string; description: string; tone: 'green' | 'amber' | 'purple' }[] = [
  {
    key: 'A',
    title: 'Group A · Automatic publishing candidates',
    description: 'Official APIs with direct publishing. Connect an account and posts go out automatically.',
    tone: 'green',
  },
  {
    key: 'B',
    title: 'Group B · Official API / approval-dependent',
    description: 'Real APIs that need approval, a paid plan or specific permissions before publishing works.',
    tone: 'amber',
  },
  {
    key: 'C',
    title: 'Group C · Manual / assisted publishing',
    description: 'No supported publishing API for this workflow. ROYALWEB prepares a complete, copy-ready package.',
    tone: 'purple',
  },
];

export function PlatformsView() {
  const { push } = useToast();
  const [platforms, setPlatforms] = useState<Platform[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'A' | 'B' | 'C' | 'connected'>('all');

  const load = useCallback(async () => {
    try {
      const data = await api<{ platforms: Platform[] }>('/api/platforms');
      setPlatforms(data.platforms);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!platforms) return [];
    if (filter === 'all') return platforms;
    if (filter === 'connected') return platforms.filter((p) => p.accountCount > 0);
    return platforms.filter((p) => p.group === filter);
  }, [platforms, filter]);

  async function toggle(platform: Platform, enabled: boolean) {
    setBusy(`toggle:${platform.id}`);
    try {
      await api(`/api/platforms/${platform.id}`, { method: 'PATCH', body: { enabled } });
      push(`${platform.name} ${enabled ? 'enabled' : 'disabled'}`, 'success');
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const connectedCount = platforms?.filter((p) => p.accountCount > 0).length ?? 0;
  const autoCount = platforms?.filter((p) => p.automation !== 'manual').length ?? 0;
  const manualCount = platforms?.filter((p) => p.automation === 'manual').length ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="25 platforms"
        title="Platform management"
        description="Every integration is a separate adapter with its own authentication, content formatting, media handling and error reporting. Statuses below are computed from real connection and job records."
        actions={
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', `All ${platforms?.length ?? 25}`],
                ['A', 'Group A'],
                ['B', 'Group B'],
                ['C', 'Group C'],
                ['connected', `Connected ${connectedCount}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors',
                  filter === key
                    ? 'border-gold-500/40 bg-gold-500/10 text-gold-200'
                    : 'border-white/[0.08] text-ink-400 hover:bg-white/[0.04]'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-ink-500">Total</div><div className="mt-1 text-[20px] font-semibold text-ink-100">{platforms?.length ?? 25}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-ink-500">API-capable</div><div className="mt-1 text-[20px] font-semibold text-ok">{autoCount}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-ink-500">Manual</div><div className="mt-1 text-[20px] font-semibold text-[#c3aee8]">{manualCount}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase tracking-wider text-ink-500">Connected</div><div className="mt-1 text-[20px] font-semibold text-gold-300">{connectedCount}</div></Card>
      </div>

      {error ? <Notice tone="red">{error}</Notice> : null}
      {!platforms ? (
        <div className="py-12"><Spinner label="Loading platforms…" /></div>
      ) : (
        <div className="space-y-5">
          {GROUPS.filter((g) => filter === 'all' || filter === g.key || (filter === 'connected' && platformCount(filtered, g.key) > 0)).map((group) => {
            const items = filter === 'all' || filter === 'connected' ? filtered.filter((p) => p.group === group.key) : filtered;
            if (!items.length) return null;
            return (
              <div key={group.key}>
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  <h2 className="text-[13px] font-semibold tracking-tight text-ink-100">{group.title}</h2>
                  <Badge tone={group.tone}>{items.length}</Badge>
                </div>
                <p className="mb-3 text-[11.5px] text-ink-500">{group.description}</p>
                <div className="grid gap-2.5 lg:grid-cols-2">
                  {items.map((platform) => {
                    const open = expanded === platform.id;
                    return (
                      <Card key={platform.id} className="overflow-hidden">
                        <div className="flex items-start gap-3 p-3.5">
                          <PlatformMark id={platform.id} name={platform.name} size="lg" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-ink-600">#{platform.number}</span>
                              <h3 className="truncate text-[13.5px] font-medium text-ink-100">{platform.name}</h3>
                              {!platform.enabled ? <Badge tone="neutral">disabled</Badge> : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <StatusBadge status={platform.status} />
                              <Badge tone={platform.automation === 'manual' ? 'purple' : platform.automation === 'approval' ? 'amber' : 'green'}>
                                {platform.automationLabel}
                              </Badge>
                              {platform.accountCount > 0 ? (
                                <Badge tone="gold">{platform.accountCount} account{platform.accountCount > 1 ? 's' : ''}</Badge>
                              ) : null}
                            </div>
                            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">{platform.integration}</p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <Switch checked={platform.enabled} onChange={(next) => toggle(platform, next)} disabled={busy === `toggle:${platform.id}`} />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 divide-x divide-white/[0.05] border-y border-white/[0.05] bg-white/[0.015] text-center">
                          <div className="px-2 py-1.5">
                            <div className="text-[9.5px] uppercase tracking-wider text-ink-500">Published</div>
                            <div className="text-[12px] font-medium text-ok">{platform.publishedCount}</div>
                          </div>
                          <div className="px-2 py-1.5">
                            <div className="text-[9.5px] uppercase tracking-wider text-ink-500">Scheduled</div>
                            <div className="text-[12px] font-medium text-gold-300">{platform.scheduledCount}</div>
                          </div>
                          <div className="px-2 py-1.5">
                            <div className="text-[9.5px] uppercase tracking-wider text-ink-500">Failed</div>
                            <div className={cn('text-[12px] font-medium', platform.failedCount ? 'text-danger' : 'text-ink-400')}>
                              {platform.failedCount}
                            </div>
                          </div>
                        </div>

                        {platform.lastError ? (
                          <div className="flex items-start gap-2 border-b border-danger/15 bg-danger/[0.05] px-3.5 py-2 text-[11px] text-[#f0c2c5]">
                            <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                            <span className="line-clamp-2">{platform.lastError}</span>
                          </div>
                        ) : null}

                        <div className="flex items-center justify-between px-3.5 py-2.5">
                          <div className="text-[10.5px] text-ink-500">
                            {platform.lastActivityAt ? `last activity ${relativeTime(platform.lastActivityAt)}` : 'no activity yet'}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {platform.automation !== 'manual' ? (
                              <Link href="/dashboard/accounts" className="text-[11px] text-gold-300 hover:text-gold-200">
                                Connect
                              </Link>
                            ) : (
                              <Link href="/dashboard/manual" className="text-[11px] text-[#c3aee8] hover:text-[#ded1f2]">
                                Manual queue
                              </Link>
                            )}
                            <button
                              onClick={() => setExpanded(open ? null : platform.id)}
                              className="rounded-md p-1 text-ink-400 hover:bg-white/5 hover:text-ink-100"
                              aria-label="Show details"
                            >
                              <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
                            </button>
                          </div>
                        </div>

                        {open ? (
                          <div className="space-y-3 border-t border-white/[0.06] px-3.5 py-3 text-[11.5px] leading-relaxed">
                            <div>
                              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-500">
                                <KeyRound size={11} /> Connection
                              </div>
                              <p className="text-ink-300">{platform.connectInstructions}</p>
                            </div>
                            <div>
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">Permissions &amp; limits</div>
                              <p className="text-ink-300">{platform.permissionNotes}</p>
                            </div>
                            <div>
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">Integration notes</div>
                              <p className="text-ink-400">{platform.notes}</p>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {platform.capabilities.text ? <Badge tone="neutral">text</Badge> : null}
                              {platform.capabilities.image ? <Badge tone="neutral">image</Badge> : null}
                              {platform.capabilities.video ? <Badge tone="neutral">video</Badge> : null}
                              {platform.capabilities.article ? <Badge tone="neutral">article</Badge> : null}
                              {platform.capabilities.imageViaUrl ? <Badge tone="amber">image needs public URL</Badge> : null}
                              {platform.rendererAvailable === false ? <Badge tone="red">ffmpeg missing</Badge> : null}
                              {platform.oauthRequired ? (
                                <Badge tone={platform.oauthConfigured ? 'green' : 'purple'}>
                                  {platform.oauthConfigured ? 'OAuth configured' : 'OAuth client needed'}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <a
                                href={platform.docsUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1 text-[11px] text-gold-300 hover:text-gold-200"
                              >
                                <BookOpen size={11} /> Official docs <ExternalLink size={9} />
                              </a>
                              {platform.manualUrl ? (
                                <a href={platform.manualUrl} target="_blank" rel="noreferrer noopener" className="text-[11px] text-ink-400 hover:text-ink-200">
                                  Open platform ↗
                                </a>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5">
        <Notice tone="neutral" title="Honest status reporting">
          A platform is marked CONNECTED only when a real account has been verified against its API. Approval-dependent
          platforms show “Approval required” until the provider grants access. Manual platforms never claim to publish —
          they produce a package you upload yourself.
        </Notice>
      </div>
    </div>
  );
}

function platformCount(list: Platform[], group: string) {
  return list.filter((p) => p.group === group).length;
}
