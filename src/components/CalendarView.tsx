'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, Badge, Button, Card, EmptyState, Notice, PageHeader, Spinner, StatusBadge, cn } from '@/components/ui';
import { PlatformMark } from '@/components/PlatformMark';
import { formatInZone } from '@/lib/time';

interface Job {
  id: string;
  campaignId: string;
  campaignName?: string;
  platformId: string;
  platformName?: string;
  status: string;
  scheduledAt: string;
  publishedUrl: string | null;
  error: string | null;
}

export function CalendarView({ timezone }: { timezone: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ jobs: Job[] }>('/api/jobs?status=all&limit=300');
      setJobs(data.jobs);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grid = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const cells: { date: Date | null }[] = [];
    for (let i = 0; i < startWeekday; i += 1) cells.push({ date: null });
    for (let d = 1; d <= daysInMonth; d += 1) cells.push({ date: new Date(cursor.year, cursor.month, d) });
    while (cells.length % 7 !== 0) cells.push({ date: null });
    return cells;
  }, [cursor]);

  function dateKey(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const byDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    (jobs ?? []).forEach((job) => {
      const key = dateKey(job.scheduledAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    });
    return map;
  }, [jobs]);

  const upcoming = useMemo(
    () =>
      (jobs ?? [])
        .filter((j) => new Date(j.scheduledAt).getTime() >= Date.now() && j.status === 'scheduled')
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
        .slice(0, 8),
    [jobs]
  );

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div>
      <PageHeader
        eyebrow="Schedule"
        title="Publishing calendar"
        description={`All job times are shown in ${timezone}. Jobs persist across restarts and run through the background worker.`}
        actions={
          <Button variant="secondary" onClick={() => void load()}>Refresh</Button>
        }
      />

      {error ? <Notice tone="red">{error}</Notice> : null}

      {!jobs ? (
        <div className="py-12"><Spinner label="Loading calendar…" /></div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays size={16} className="text-gold-400" />
                <h2 className="text-[14px] font-medium text-ink-100">{monthLabel}</h2>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => load}
                  className="hidden"
                  aria-hidden
                />
                <button
                  className="rounded-lg border border-white/[0.08] p-1.5 text-ink-300 hover:bg-white/[0.05]"
                  onClick={() => setCursor(({ year, month }) => (month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }))}
                  aria-label="Previous month"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  className="rounded-lg border border-white/[0.08] p-1.5 text-ink-300 hover:bg-white/[0.05]"
                  onClick={() => setCursor(({ year, month }) => (month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }))}
                  aria-label="Next month"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[9.5px] uppercase tracking-wider text-ink-500">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {grid.map((cell, index) => {
                if (!cell.date) return <div key={`empty-${index}`} className="min-h-[64px] rounded-lg bg-white/[0.01]" />;
                const key = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, '0')}-${String(cell.date.getDate()).padStart(2, '0')}`;
                const dayJobs = byDay.get(key) ?? [];
                const isToday = key === dateKey(new Date().toISOString());
                return (
                  <div
                    key={key}
                    className={cn(
                      'min-h-[64px] rounded-lg border p-1.5',
                      isToday ? 'border-gold-500/40 bg-gold-500/[0.06]' : 'border-white/[0.05] bg-white/[0.015]'
                    )}
                  >
                    <div className={cn('text-[10px]', isToday ? 'font-semibold text-gold-300' : 'text-ink-500')}>
                      {cell.date.getDate()}
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {dayJobs.slice(0, 3).map((job) => (
                        <Link
                          key={job.id}
                          href={`/dashboard/campaigns/${job.campaignId}`}
                          title={`${job.platformName} · ${job.status}`}
                          className={cn(
                            'block truncate rounded px-1 py-0.5 text-[8.5px]',
                            job.status === 'published'
                              ? 'bg-ok/15 text-ok'
                              : job.status === 'scheduled'
                                ? 'bg-gold-500/15 text-gold-200'
                                : job.status === 'processing'
                                  ? 'bg-info/15 text-info'
                                  : 'bg-danger/15 text-danger'
                          )}
                        >
                          {job.platformName}
                        </Link>
                      ))}
                      {dayJobs.length > 3 ? (
                        <div className="px-1 text-[8px] text-ink-500">+{dayJobs.length - 3}</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <div className="border-b border-white/[0.06] px-4 py-3">
                <h3 className="text-[13px] font-medium text-ink-100">Next scheduled</h3>
              </div>
              {upcoming.length === 0 ? (
                <EmptyState title="Nothing upcoming" description="Schedule an approved campaign to fill the calendar." />
              ) : (
                <div className="divide-y divide-white/[0.05]">
                  {upcoming.map((job) => (
                    <div key={job.id} className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <PlatformMark id={job.platformId} name={job.platformName} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11.5px] text-ink-200">{job.platformName}</div>
                          <div className="truncate text-[10px] text-ink-500">{job.campaignName}</div>
                        </div>
                        <StatusBadge status={job.status} />
                      </div>
                      <div className="mt-1 text-[10px] text-gold-300/80">{formatInZone(job.scheduledAt, timezone)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500">Legend</div>
              <div className="mt-2 space-y-1.5 text-[11px]">
                <Legend color="bg-gold-500/60" label="Scheduled" />
                <Legend color="bg-info/60" label="Processing" />
                <Legend color="bg-ok/60" label="Published" />
                <Legend color="bg-danger/60" label="Failed / connection expired" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge tone="gold">Asia/Kolkata default</Badge>
                <Badge tone="neutral">per-platform times supported</Badge>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2 w-2 rounded-sm', color)} />
      <span className="text-ink-400">{label}</span>
    </div>
  );
}
