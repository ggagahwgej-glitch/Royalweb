'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RotateCw, Ban, Send, ExternalLink, RefreshCw } from 'lucide-react';
import {
  api,
  Badge,
  Button,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Spinner,
  StatusBadge,
  useToast,
} from '@/components/ui';
import { PlatformMark } from '@/components/PlatformMark';
import { formatInZone, relativeTime } from '@/lib/time';

interface Job {
  id: string;
  campaignId: string;
  campaignName?: string;
  platformId: string;
  platformName?: string;
  accountName: string | null;
  status: string;
  scheduledAt: string;
  attempts: number;
  error: string | null;
  errorCode: string | null;
  publishedUrl: string | null;
  automation?: string;
  retryInMinutes?: number | null;
}

export function JobsView({
  filter,
  title,
  description,
  timezone = 'Asia/Kolkata',
  actions,
}: {
  filter: 'scheduled' | 'published' | 'failed' | 'all';
  title: string;
  description: string;
  timezone?: string;
  actions?: React.ReactNode;
}) {
  const { push } = useToast();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ jobs: Job[] }>(`/api/jobs?status=${filter}&limit=200`);
      setJobs(data.jobs);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [filter]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(job: Job, action: 'retry' | 'cancel' | 'publish') {
    setBusy(`${action}:${job.id}`);
    try {
      const data = await api<{ outcome?: { status: string; message: string } }>(`/api/jobs/${job.id}/action`, {
        method: 'POST',
        body: { action },
      });
      push(data.outcome?.message ?? (action === 'cancel' ? 'Job cancelled' : 'Action completed'), data.outcome && data.outcome.status !== 'published' ? 'info' : 'success');
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void load()}>
              Refresh
            </Button>
          </>
        }
      />
      {error ? <Notice tone="red">{error}</Notice> : null}
      {!jobs ? (
        <div className="py-12"><Spinner label="Loading jobs…" /></div>
      ) : jobs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Send size={22} />}
            title={
              filter === 'scheduled'
                ? 'Nothing scheduled'
                : filter === 'published'
                  ? 'No confirmed publications yet'
                  : filter === 'failed'
                    ? 'No failures recorded'
                    : 'No jobs yet'
            }
            description={
              filter === 'failed'
                ? 'When a platform rejects a post or a token expires, the exact error appears here with a retry option.'
                : 'Jobs appear as soon as you schedule an approved campaign.'
            }
            action={
              filter === 'scheduled' ? (
                <Link href="/dashboard/new" className="text-[12px] text-gold-300 hover:text-gold-200">
                  Create a campaign →
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-[12px]">
              <thead className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Platform</th>
                  <th className="px-3 py-2.5 font-medium">Campaign</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Detail</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {jobs.map((job) => (
                  <tr key={job.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <PlatformMark id={job.platformId} name={job.platformName} size="sm" />
                        <div>
                          <div className="text-[12px] text-ink-100">{job.platformName}</div>
                          <div className="text-[10px] text-ink-500">{job.accountName ?? 'no account'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[180px] px-3 py-3">
                      <Link href={`/dashboard/campaigns/${job.campaignId}`} className="truncate text-[11.5px] text-ink-300 hover:text-gold-300">
                        {job.campaignName}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={job.status} />
                      {job.errorCode === 'auth_expired' ? <div className="mt-1"><Badge tone="red">CONNECTION EXPIRED</Badge></div> : null}
                    </td>
                    <td className="px-3 py-3 text-[11px] text-ink-400">
                      {formatInZone(job.scheduledAt, timezone)}
                      <div className="text-[10px] text-ink-500">{relativeTime(job.scheduledAt)}</div>
                    </td>
                    <td className="max-w-[280px] px-3 py-3">
                      {job.publishedUrl ? (
                        <a href={job.publishedUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[11px] text-gold-300 hover:text-gold-200">
                          View post <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span className="line-clamp-2 text-[11px] text-ink-400">{job.error ?? 'Queued'}</span>
                      )}
                      {job.attempts > 0 && job.status !== 'published' ? (
                        <div className="mt-0.5 text-[10px] text-ink-500">
                          attempts {job.attempts}
                          {job.retryInMinutes ? ` · next in ~${job.retryInMinutes}m` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {job.status !== 'published' && job.status !== 'cancelled' ? (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy === `retry:${job.id}`}
                              onClick={() => act(job, 'retry')}
                              icon={<RotateCw size={11} />}
                            >
                              Retry
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={busy === `cancel:${job.id}`}
                              onClick={() => act(job, 'cancel')}
                              icon={<Ban size={11} />}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : null}
                        {job.status === 'published' ? <Badge tone="green">confirmed</Badge> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="divide-y divide-white/[0.05] md:hidden">
            {jobs.map((job) => (
              <div key={job.id} className="p-3.5">
                <div className="flex items-start gap-2.5">
                  <PlatformMark id={job.platformId} name={job.platformName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12.5px] font-medium text-ink-100">{job.platformName}</span>
                      <StatusBadge status={job.status} />
                    </div>
                    <Link href={`/dashboard/campaigns/${job.campaignId}`} className="mt-0.5 block truncate text-[11px] text-ink-400">
                      {job.campaignName}
                    </Link>
                    <div className="mt-0.5 text-[10.5px] text-ink-500">{formatInZone(job.scheduledAt, timezone)}</div>
                    {job.error ? <p className="mt-1 text-[11px] leading-relaxed text-danger/90">{job.error.slice(0, 200)}</p> : null}
                    {job.publishedUrl ? (
                      <a href={job.publishedUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-[11px] text-gold-300">
                        View post <ExternalLink size={10} />
                      </a>
                    ) : null}
                    {job.status !== 'published' && job.status !== 'cancelled' ? (
                      <div className="mt-2 flex gap-1.5">
                        <Button size="sm" variant="secondary" loading={busy === `retry:${job.id}`} onClick={() => act(job, 'retry')}>Retry</Button>
                        <Button size="sm" variant="ghost" loading={busy === `cancel:${job.id}`} onClick={() => act(job, 'cancel')}>Cancel</Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
