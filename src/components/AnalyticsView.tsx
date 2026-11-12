'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CircleAlert, Info } from 'lucide-react';
import {
  api,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Notice,
  PageHeader,
  ProgressBar,
  Spinner,
  Stat,
  StatusBadge,
} from '@/components/ui';
import { PlatformMark } from '@/components/PlatformMark';
import { formatInZone, relativeTime } from '@/lib/time';

interface Analytics {
  totals: Record<string, number>;
  platformActivity: {
    id: string;
    name: string;
    grp: string;
    automation: string;
    enabled: number;
    credential_status: string;
    last_activity_at: string | null;
    accounts: number;
    published: number;
    scheduled: number;
    failed: number;
    manual_published: number;
  }[];
  daily: { day: string; status: string; c: number }[];
  recent: {
    id: string;
    status: string;
    error: string | null;
    published_url: string | null;
    scheduled_at: string;
    updated_at: string;
    platform_name: string;
    campaign_name: string;
  }[];
  manualByPlatform: { name: string; status: string; c: number }[];
  engagement: { available: boolean; reason: string; metrics: unknown[] };
  generatedAt: string;
}

export function AnalyticsView() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Analytics>('/api/analytics')
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, []);

  const maxDaily = useMemo(() => {
    if (!data) return 1;
    const sums = new Map<string, number>();
    data.daily.forEach((row) => sums.set(row.day, (sums.get(row.day) ?? 0) + Number(row.c)));
    return Math.max(1, ...[...sums.values()]);
  }, [data]);

  const yesterday = useMemo(() => {
    if (!data) return [];
    const days: { day: string; total: number; published: number }[] = [];
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      const rows = data.daily.filter((r) => r.day === date);
      days.push({
        day: date,
        total: rows.reduce((s, r) => s + Number(r.c), 0),
        published: rows.filter((r) => r.status === 'published').reduce((s, r) => s + Number(r.c), 0),
      });
    }
    return days;
  }, [data]);

  if (error) return <Notice tone="red">{error}</Notice>;
  if (!data) return <div className="py-12"><Spinner label="Crunching real records…" /></div>;

  const t = data.totals;
  const activePlatforms = data.platformActivity.filter((p) => p.published + p.scheduled + p.failed > 0);

  return (
    <div>
      <PageHeader
        eyebrow="Reporting"
        title="Analytics"
        description="Computed from ROYALWEB's own publishing records. Engagement metrics are shown only where a platform API actually returns them — never estimated."
        actions={<Badge tone="neutral">as of {new Date(data.generatedAt).toLocaleTimeString()}</Badge>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Campaigns" value={t.campaigns} />
        <Stat label="Posters" value={t.media} />
        <Stat label="Generated" value={t.contents} />
        <Stat label="Scheduled" value={t.scheduled} tone="gold" />
        <Stat label="Published" value={t.published} tone="green" />
        <Stat label="Failed" value={t.failed} tone={t.failed ? 'red' : 'neutral'} />
        <Stat label="Manual pending" value={t.manualPending} tone={t.manualPending ? 'purple' : 'neutral'} />
        <Stat label="Connected" value={`${t.connectedPlatforms}/25`} tone="gold" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Publishing volume" subtitle="Jobs updated per day (last 14 days)" icon={<BarChart3 size={16} />} />
          <div className="px-5 py-5">
            <div className="flex h-40 items-end gap-1.5">
              {yesterday.map((day) => (
                <div key={day.day} className="group flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-col justify-end" style={{ height: '140px' }}>
                    <div
                      className="w-full rounded-t bg-gold-500/30"
                      style={{ height: `${(day.total / maxDaily) * 100}%`, minHeight: day.total ? '4px' : '0' }}
                      title={`${day.day}: ${day.total} jobs (${day.published} published)`}
                    >
                      <div
                        className="w-full rounded-t bg-ok/70"
                        style={{ height: day.total ? `${(day.published / day.total) * 100}%` : '0' }}
                      />
                    </div>
                  </div>
                  <span className="text-[8px] text-ink-600">{day.day.slice(8)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[10.5px] text-ink-500">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-ok/70" /> published</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-gold-500/30" /> other job updates</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Funnel" subtitle="Approval to confirmed publication" icon={<BarChart3 size={16} />} />
          <div className="space-y-3.5 px-5 py-4">
            <Funnel label="Content generated" value={t.contents} total={Math.max(t.contents, 1)} tone="gold" />
            <Funnel label="Jobs created" value={t.scheduled + t.published + t.failed} total={Math.max(t.contents, 1)} tone="blue" />
            <Funnel label="Published" value={t.published} total={Math.max(t.contents, 1)} tone="green" />
            <Funnel label="Manual published" value={t.manualPublished} total={Math.max(t.manualPending + t.manualPublished, 1)} tone="purple" />
            <div className="pt-1 text-[10.5px] leading-relaxed text-ink-500">
              Manual tasks are tracked separately because they are published by you, not by an API.
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Platform activity" subtitle="Real job outcomes per platform" icon={<BarChart3 size={16} />} />
          {activePlatforms.length === 0 ? (
            <EmptyState title="No platform activity yet" description="Publish or schedule a campaign to populate this table." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Platform</th>
                    <th className="px-2 py-2 font-medium">Group</th>
                    <th className="px-2 py-2 font-medium">Accounts</th>
                    <th className="px-2 py-2 font-medium">Published</th>
                    <th className="px-2 py-2 font-medium">Scheduled</th>
                    <th className="px-2 py-2 font-medium">Failed</th>
                    <th className="px-4 py-2 font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {activePlatforms.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <PlatformMark id={row.id} name={row.name} size="sm" />
                          <span className="text-[12px] text-ink-100">{row.name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-[11px] text-ink-400">{row.grp}</td>
                      <td className="px-2 py-2 text-[11px] text-ink-300">{row.accounts}</td>
                      <td className="px-2 py-2 text-[11px] text-ok">{row.published}</td>
                      <td className="px-2 py-2 text-[11px] text-gold-300">{row.scheduled}</td>
                      <td className={`px-2 py-2 text-[11px] ${row.failed ? 'text-danger' : 'text-ink-500'}`}>{row.failed}</td>
                      <td className="px-4 py-2 text-[10.5px] text-ink-500">{row.last_activity_at ? relativeTime(row.last_activity_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Engagement metrics" subtitle="Only what platforms actually return" icon={<Info size={16} />} />
            <div className="px-5 py-4">
              <Notice tone="amber" title="Unavailable — not zero">
                {data.engagement.reason}
              </Notice>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {['Impressions', 'Likes', 'Clicks'].map((metric) => (
                  <div key={metric} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
                    <div className="text-[9.5px] uppercase tracking-wider text-ink-500">{metric}</div>
                    <div className="mt-1 text-[11px] text-ink-500">unavailable</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent outcomes" subtitle="Latest job updates" icon={<CircleAlert size={16} />} />
            <div className="divide-y divide-white/[0.05]">
              {data.recent.slice(0, 8).map((row) => (
                <div key={row.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11.5px] text-ink-200">{row.platform_name}</span>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="mt-0.5 truncate text-[10.5px] text-ink-500">
                    {row.campaign_name} · {formatInZone(row.updated_at, 'Asia/Kolkata')}
                  </div>
                  {row.error ? <div className="mt-0.5 line-clamp-1 text-[10.5px] text-danger/80">{row.error}</div> : null}
                </div>
              ))}
              {data.recent.length === 0 ? <div className="px-4 py-5 text-[11.5px] text-ink-500">No job activity yet.</div> : null}
            </div>
            <div className="border-t border-white/[0.05] px-4 py-2.5">
              <Link href="/dashboard/published" className="text-[11px] text-gold-300 hover:text-gold-200">Open publishing history →</Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Funnel({ label, value, total, tone }: { label: string; value: number; total: number; tone: 'gold' | 'green' | 'blue' | 'purple' }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-ink-300">{label}</span>
        <span className="text-ink-400">{value}</span>
      </div>
      <ProgressBar value={value} total={total} tone={tone} />
    </div>
  );
}
