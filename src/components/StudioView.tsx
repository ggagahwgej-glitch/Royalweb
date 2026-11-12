'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Bot, ExternalLink, Sparkles, Wand2 } from 'lucide-react';
import {
  api,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Notice,
  PageHeader,
  ProgressBar,
  Spinner,
  StatusBadge,
  useToast,
} from '@/components/ui';
import { relativeTime } from '@/lib/time';

interface Campaign {
  id: string;
  name: string;
  status: string;
  contentCount?: number;
  approvedCount?: number;
  mediaCount?: number;
  updatedAt: string;
}

interface ActivityRow {
  id: string;
  kind: string;
  provider: string;
  model: string;
  ok: number;
  error: string | null;
  created_at: string;
}

export function StudioView() {
  const { push } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [ai, setAi] = useState<{ configured: boolean; provider: string; label: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    const [c, settings, a] = await Promise.all([
      api<{ campaigns: Campaign[] }>('/api/campaigns'),
      api<{ settings: { aiProvider: string; aiModel: string }; secrets: { key: string; configured: boolean }[]; providers: { id: string; label: string }[] }>('/api/settings'),
      api<{ activity: ActivityRow[] }>('/api/ai/activity'),
    ]);
    setCampaigns(c.campaigns);
    setActivity(a.activity);
    const key = settings.secrets.find((s) => s.key === 'ai.apiKey')?.configured;
    const provider = settings.providers.find((p) => p.id === settings.settings.aiProvider)?.label ?? 'Auto';
    setAi({
      configured: Boolean(key),
      provider: settings.settings.aiProvider,
      label: `${provider}${settings.settings.aiModel ? ` · ${settings.settings.aiModel}` : ''}`,
    });
  }, []);

  useEffect(() => {
    load().catch((err) => push((err as Error).message, 'error'));
  }, [load, push]);

  async function generate(campaign: Campaign) {
    setBusy(`gen:${campaign.id}`);
    try {
      const result = await api<{ mode: string; notices: string[] }>(`/api/campaigns/${campaign.id}/generate`, {
        method: 'POST',
        body: {},
      });
      push(
        result.mode === 'ai'
          ? 'AI content generated for all platforms'
          : result.mode === 'mixed'
            ? 'AI content generated; some platforms used the template engine'
            : 'Generated with the built-in template engine',
        'success'
      );
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function testProvider() {
    setBusy('test');
    setTest(null);
    try {
      const result = await api<{ ok: boolean; provider?: string; model?: string; latencyMs?: number; message?: string; mode?: string }>(
        '/api/settings/test-ai',
        { method: 'POST', body: {} }
      );
      setTest({
        ok: Boolean(result.ok),
        message: result.ok
          ? `${result.provider} · ${result.model} responded in ${result.latencyMs}ms`
          : result.message ?? 'Template engine active (no AI provider configured).',
      });
      await load();
    } catch (err) {
      setTest({ ok: false, message: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Content intelligence"
        title="AI Content Studio"
        description="Where posters become platform-native copy. Generation is a draft step — nothing is published from here."
        actions={
          <Link href="/dashboard/new">
            <span className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 px-4 py-2.5 text-[13px] font-medium text-obsidian-950">
              <Wand2 size={14} /> New campaign
            </span>
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {!campaigns ? (
            <div className="py-12"><Spinner label="Loading studio…" /></div>
          ) : campaigns.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Sparkles size={22} />}
                title="No campaigns yet"
                description="Upload a poster in the campaign wizard and ROYALWEB will write distinct copy for each platform you select."
                action={<Link href="/dashboard/new" className="text-[12px] text-gold-300 hover:text-gold-200">Create a campaign →</Link>}
              />
            </Card>
          ) : (
            <Card>
              <CardHeader title="Campaign content" subtitle="Generate or top up platform content per campaign." icon={<Sparkles size={16} />} />
              <div className="divide-y divide-white/[0.05]">
                {campaigns.map((campaign) => {
                  const produced = campaign.contentCount ?? 0;
                  const approved = campaign.approvedCount ?? 0;
                  return (
                    <div key={campaign.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/dashboard/campaigns/${campaign.id}`} className="text-[13px] font-medium text-ink-100 hover:text-gold-200">
                          {campaign.name}
                        </Link>
                        <StatusBadge status={campaign.status} />
                        <span className="text-[10.5px] text-ink-500">updated {relativeTime(campaign.updatedAt)}</span>
                        <div className="ml-auto flex gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy === `gen:${campaign.id}`}
                            onClick={() => generate(campaign)}
                            icon={<Sparkles size={12} />}
                          >
                            {produced ? 'Regenerate all' : 'Generate all'}
                          </Button>
                          <Link
                            href={`/dashboard/campaigns/${campaign.id}`}
                            className="inline-flex items-center gap-1 rounded-xl border border-white/[0.09] px-2.5 py-1.5 text-[11.5px] text-ink-200 hover:bg-white/[0.05]"
                          >
                            Review <ExternalLink size={10} />
                          </Link>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex-1">
                          <ProgressBar value={approved} total={Math.max(produced, 1)} tone={approved === produced && produced > 0 ? 'green' : 'gold'} />
                        </div>
                        <span className="shrink-0 text-[10.5px] text-ink-500">
                          {approved}/{produced} approved · {campaign.mediaCount ?? 0} posters
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="AI activity" subtitle="Every generation attempt, including failures and provider mode." icon={<Bot size={16} />} />
            {activity.length === 0 ? (
              <div className="px-5 py-5 text-[12px] text-ink-400">No AI activity recorded yet.</div>
            ) : (
              <div className="max-h-80 divide-y divide-white/[0.04] overflow-y-auto">
                {activity.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center gap-2 px-5 py-2 text-[11px]">
                    <Badge tone={row.ok ? 'green' : 'red'}>{row.ok ? 'ok' : 'failed'}</Badge>
                    <span className="text-ink-300">{row.kind.replace(/_/g, ' ')}</span>
                    <span className="text-ink-500">{row.provider}{row.model ? ` · ${row.model}` : ''}</span>
                    <span className="ml-auto text-[10px] text-ink-500">{relativeTime(row.created_at)}</span>
                    {row.error ? <div className="w-full text-[10.5px] text-danger/80">{row.error.slice(0, 220)}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink-200">
              <Bot size={15} className="text-gold-400" /> AI provider
            </div>
            {ai ? (
              <>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-[11.5px] text-ink-400">Mode</span>
                  <Badge tone={ai.configured ? 'green' : 'amber'} dot>
                    {ai.configured ? 'AI generation' : 'Template engine'}
                  </Badge>
                </div>
                <div className="mt-1.5 text-[11.5px] text-ink-300">{ai.label}</div>
                <div className="mt-3 space-y-2">
                  <Button variant="secondary" className="w-full" loading={busy === 'test'} onClick={testProvider}>
                    Test provider
                  </Button>
                  <Link href="/dashboard/settings" className="block text-center text-[11px] text-gold-300 hover:text-gold-200">
                    Configure provider →
                  </Link>
                </div>
                {test ? <div className="mt-3"><Notice tone={test.ok ? 'green' : 'amber'}>{test.message}</Notice></div> : null}
              </>
            ) : (
              <Spinner />
            )}
          </Card>

          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500">What the AI does</div>
            <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-ink-400">
              <li>• Reads the poster (vision models) and the campaign details</li>
              <li>• Writes a different caption per platform and per limit</li>
              <li>• Produces titles, hashtags, alt text and article bodies</li>
              <li>• Never invents prices, numbers or client claims</li>
              <li>• Falls back to templates — clearly labelled — if it fails</li>
            </ul>
          </Card>

          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500">Need a content plan?</div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-400">
              Ask the assistant to plan a campaign, choose platforms or explain a publishing error.
            </p>
            <Link href="/dashboard/assistant" className="mt-2 inline-block text-[11.5px] text-gold-300 hover:text-gold-200">
              Open AI assistant →
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
