'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  Eye,
  FileText,
  Image as ImageIcon,
  History,
  Pause,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  Badge,
  Button,
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  ProgressBar,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
  cn,
  useToast,
} from '@/components/ui';
import { PlatformMark } from '@/components/PlatformMark';
import { formatInZone, utcToLocalInput, zonedToUtc, relativeTime } from '@/lib/time';

interface Content {
  id: string;
  platformId: string;
  platformName: string;
  automation: string;
  title: string;
  caption: string;
  description: string;
  hashtags: string[];
  cta: string;
  destinationUrl: string;
  altText: string;
  status: string;
  generator: string;
  model: string;
  version: number;
}

interface Job {
  id: string;
  platformId: string;
  platformName: string;
  status: string;
  scheduledAt: string;
  error: string | null;
  errorCode: string | null;
  attempts: number;
  publishedUrl: string | null;
  accountName: string | null;
  automation: string;
  retryInMinutes: number | null;
}

interface MediaItem {
  id: string;
  originalName: string;
  width: number | null;
  height: number | null;
  bytes: number;
  kind: string;
  thumbUrl: string;
  fileUrl: string;
}

interface Detail {
  campaign: {
    id: string;
    name: string;
    status: string;
    timezone: string;
    recurrence: string;
    scheduledAt: string | null;
    analysis: {
      summary?: string;
      source?: string;
      model?: string;
      provider?: string;
      image?: { width: number; height: number; orientation: string; dominantColor: string };
    };
    aiProvider: string;
    aiModel: string;
    businessCategory: string;
    serviceName: string;
    offerPrice: string;
  };
  media: MediaItem[];
  contents: Content[];
  jobs: Job[];
  manualTasks: { id: string; platformName: string; status: string }[];
  logs: { id: string; level: string; step: string; message: string; created_at: string; platform_id: string }[];
  progress: Record<string, number>;
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const searchParams = useSearchParams();
  const { push } = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Content>>({});
  const [compare, setCompare] = useState<{ media: MediaItem; platform: string; name: string } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<Detail>(`/api/campaigns/${campaignId}`);
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get('generated') === '1') {
      push('Content generated — review each platform, then approve and schedule.', 'success');
    }
  }, [searchParams, push]);

  const approvedCount = data?.contents.filter((c) => c.status === 'approved').length ?? 0;
  const total = data?.contents.length ?? 0;

  async function act(key: string, fn: () => Promise<unknown>, message?: string) {
    setBusy(key);
    try {
      await fn();
      if (message) push(message, 'success');
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  function startEdit(content: Content) {
    setEditing(content.id);
    setDraft({
      title: content.title,
      caption: content.caption,
      description: content.description,
      hashtags: content.hashtags,
      cta: content.cta,
      destinationUrl: content.destinationUrl,
    });
  }

  async function saveContent(content: Content, extra?: { status?: string }) {
    await act(
      `save:${content.id}`,
      () =>
        api(`/api/contents/${content.id}`, {
          method: 'PATCH',
          body: {
            title: draft.title ?? content.title,
            caption: draft.caption ?? content.caption,
            description: draft.description ?? content.description,
            hashtags: draft.hashtags ?? content.hashtags,
            cta: draft.cta ?? content.cta,
            destinationUrl: draft.destinationUrl ?? content.destinationUrl,
            ...(extra?.status ? { status: extra.status } : {}),
          },
        }),
      extra?.status === 'approved' ? 'Approved' : 'Saved'
    );
    setEditing(null);
  }

  if (error) {
    return (
      <Notice tone="red" title="Could not load campaign">
        {error}
      </Notice>
    );
  }
  if (!data) {
    return (
      <div className="py-16">
        <Spinner label="Loading campaign…" />
      </div>
    );
  }

  const { campaign, media, contents, jobs, manualTasks, logs, progress } = data;
  const isPaused = campaign.status === 'paused';
  const isCancelled = campaign.status === 'cancelled';

  return (
    <div>
      <div className="mb-5">
        <Link href="/dashboard" className="mb-3 inline-flex items-center gap-1.5 text-[11.5px] text-ink-400 hover:text-ink-100">
          <ArrowLeft size={12} /> Back to overview
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <StatusBadge status={campaign.status} />
              {campaign.recurrence !== 'none' ? <Badge tone="gold">{campaign.recurrence}</Badge> : null}
              <span className="text-[11px] text-ink-500">
                {campaign.scheduledAt ? `scheduled ${formatInZone(campaign.scheduledAt, campaign.timezone)}` : 'not scheduled'}
              </span>
            </div>
            <h1 className="truncate text-[24px] font-semibold tracking-tight text-ink-100">{campaign.name}</h1>
            <p className="mt-1 text-[12.5px] text-ink-400">
              {campaign.serviceName || 'Website service'}
              {campaign.businessCategory ? ` · ${campaign.businessCategory}` : ''}
              {campaign.offerPrice ? ` · ${campaign.offerPrice}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isCancelled ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() =>
                    act(
                      'status',
                      () => api(`/api/campaigns/${campaign.id}/status`, { method: 'POST', body: { action: isPaused ? 'resume' : 'pause' } }),
                      isPaused ? 'Campaign resumed' : 'Campaign paused'
                    )
                  }
                  loading={busy === 'status'}
                  icon={isPaused ? <Play size={14} /> : <Pause size={14} />}
                >
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
                <Button variant="gold" onClick={() => setScheduleOpen(true)} icon={<CalendarClock size={14} />}>
                  Schedule publishing
                </Button>
              </>
            ) : (
              <Badge tone="neutral">Campaign cancelled</Badge>
            )}
          </div>
        </div>
      </div>

      {campaign.analysis?.summary ? (
        <div className="mb-4">
          <Notice tone={campaign.analysis.source === 'vision-model' ? 'gold' : 'neutral'} title={
            campaign.analysis.source === 'vision-model'
              ? `Poster analysis · ${campaign.analysis.provider ?? 'AI'} ${campaign.analysis.model ?? ''}`
              : 'Image analysis · built-in (no vision AI configured)'
          }>
            <p>{campaign.analysis.summary}</p>
            {campaign.analysis.source !== 'vision-model' ? (
              <p className="mt-1.5 text-[11.5px] opacity-80">
                Text printed on the poster was not read automatically. Configure an AI vision provider in Settings →
                AI to have posters interpreted, or add the offer details manually above.
              </p>
            ) : null}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_330px]">
        <div className="min-w-0 space-y-4">
          {/* Media */}
          <Card>
            <CardHeader
              title="Media"
              subtitle="Originals are preserved. Platform copies are generated on demand."
              icon={<ImageIcon size={16} />}
              action={
                <Link href="/dashboard/media" className="text-[12px] text-gold-300 hover:text-gold-200">
                  Library
                </Link>
              }
            />
            <div className="flex gap-3 overflow-x-auto px-4 py-4">
              {media.map((item) => (
                <div key={item.id} className="w-36 shrink-0">
                  <div className="overflow-hidden rounded-lg border border-white/[0.08]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.thumbUrl} alt={item.originalName} className="h-28 w-full object-cover" />
                  </div>
                  <div className="mt-1.5 truncate text-[10.5px] text-ink-300">{item.originalName}</div>
                  <button
                    onClick={() =>
                      setCompare({ media: item, platform: contents[0]?.platformId ?? 'x', name: contents[0]?.platformName ?? 'X' })
                    }
                    className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-gold-400 hover:text-gold-300"
                  >
                    <Eye size={10} /> Compare versions
                  </button>
                </div>
              ))}
              {!media.length ? (
                <div className="px-2 py-2 text-[12px] text-ink-400">No media attached. Upload in the media library.</div>
              ) : null}
            </div>
          </Card>

          {/* Content */}
          <Card>
            <CardHeader
              title="Platform content"
              subtitle={`${approvedCount}/${total} approved. Everything is editable before publishing.`}
              icon={<FileText size={16} />}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy === 'approve-all'}
                    onClick={() => act('approve-all', () => api('/api/contents/approve-all', { method: 'POST', body: { campaignId } }), 'All content approved')}
                    icon={<Check size={13} />}
                  >
                    Approve all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === 'regen-all'}
                    onClick={() =>
                      act(
                        'regen-all',
                        async () => {
                          for (const content of contents) {
                            await api(`/api/contents/${content.id}/regenerate`, { method: 'POST', body: {} });
                          }
                        },
                        'Content regenerated for every platform'
                      )
                    }
                    icon={<Sparkles size={13} />}
                  >
                    Regenerate all
                  </Button>
                </div>
              }
            />
            <div className="px-4 py-2">
              <ProgressBar value={approvedCount} total={total} />
            </div>

            {contents.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={20} />}
                title="No content generated yet"
                description="Generate platform-specific content for this campaign."
                action={
                  <Button
                    variant="gold"
                    loading={busy === 'generate'}
                    onClick={() =>
                      act('generate', () => api(`/api/campaigns/${campaignId}/generate`, { method: 'POST', body: {} }), 'Content generated')
                    }
                  >
                    Generate content
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {contents.map((content) => {
                  const isEditing = editing === content.id;
                  const limit =
                    content.platformId === 'x'
                      ? 280
                      : content.platformId === 'bluesky'
                        ? 300
                        : content.platformId === 'mastodon'
                          ? 500
                          : content.platformId === 'telegram'
                            ? 1024
                            : 3000;
                  return (
                    <div key={content.id} className="px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <PlatformMark id={content.platformId} name={content.platformName} size="sm" />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-ink-100">{content.platformName}</span>
                              <StatusBadge status={content.status} />
                              <Badge tone={content.generator === 'ai' ? 'gold' : 'neutral'}>
                                {content.generator === 'ai' ? 'AI' : 'Template'}
                              </Badge>
                            </div>
                            <div className="mt-0.5 text-[10.5px] text-ink-500">
                              v{content.version}
                              {content.automation === 'manual' ? ' · manual publishing' : ' · API publishing'}
                              {content.model ? ` · ${content.model}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <CopyButton value={content.caption} label="Caption" />
                          <button
                            onClick={() =>
                              setCompare({
                                media: media[0],
                                platform: content.platformId,
                                name: content.platformName,
                              })
                            }
                            disabled={!media.length}
                            className="rounded-lg border border-white/[0.09] px-2.5 py-1.5 text-[11.5px] text-ink-300 hover:bg-white/[0.05] disabled:opacity-40"
                          >
                            <Eye size={11} className="mr-1 inline" /> Image
                          </button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === `regen:${content.id}`}
                            onClick={() => act(`regen:${content.id}`, () => api(`/api/contents/${content.id}/regenerate`, { method: 'POST', body: {} }), 'Regenerated')}
                            icon={<RefreshCw size={12} />}
                          >
                            Regenerate
                          </Button>
                          {isEditing ? (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                              <Button size="sm" variant="gold" loading={busy === `save:${content.id}`} onClick={() => saveContent(content)}>Save draft</Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => startEdit(content)}>Edit</Button>
                              {content.status !== 'approved' ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  loading={busy === `approve:${content.id}`}
                                  onClick={() => act(`approve:${content.id}`, () => api(`/api/contents/${content.id}`, { method: 'PATCH', body: { status: 'approved' } }), `${content.platformName} approved`)}
                                  icon={<Check size={12} />}
                                >
                                  Approve
                                </Button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="mt-3 space-y-3 rounded-xl border border-gold-500/20 bg-gold-500/[0.03] p-3">
                          <Field label="Title">
                            <Input value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                          </Field>
                          <Field label={`Caption (${(draft.caption ?? '').length}/${limit})`}>
                            <Textarea
                              value={draft.caption ?? ''}
                              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
                              className="min-h-[120px]"
                            />
                          </Field>
                          <Field label="Description / article body">
                            <Textarea
                              value={draft.description ?? ''}
                              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                              className="min-h-[140px]"
                            />
                          </Field>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Hashtags (comma separated)">
                              <Input
                                value={(draft.hashtags ?? []).join(', ')}
                                onChange={(e) => setDraft({ ...draft, hashtags: e.target.value.split(',').map((h) => h.trim()).filter(Boolean) })}
                              />
                            </Field>
                            <Field label="Destination URL">
                              <Input value={draft.destinationUrl ?? ''} onChange={(e) => setDraft({ ...draft, destinationUrl: e.target.value })} />
                            </Field>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                            <Button size="sm" variant="secondary" loading={busy === `save:${content.id}`} onClick={() => saveContent(content)}>Save draft</Button>
                            <Button size="sm" variant="gold" loading={busy === `save-approve:${content.id}`} onClick={() => saveContent(content, { status: 'approved' })} icon={<Check size={12} />}>
                              Save & approve
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2.5 space-y-2">
                          {content.title ? (
                            <div className="text-[12.5px] font-medium text-ink-200">{content.title}</div>
                          ) : null}
                          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-ink-300">
                            {content.caption}
                          </p>
                          {content.hashtags.length ? (
                            <div className="flex flex-wrap gap-1">
                              {content.hashtags.map((tag) => (
                                <span key={tag} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-gold-300/90">
                                  #{tag.replace(/^#/, '')}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Jobs */}
          <Card>
            <CardHeader
              title="Publishing jobs"
              subtitle="Status comes from the platform's own API response."
              icon={<Send size={16} />}
              action={<Badge tone="neutral">{jobs.length} jobs</Badge>}
            />
            {jobs.length === 0 ? (
              <div className="px-5 py-6 text-[12.5px] text-ink-400">
                No jobs yet. Approve content and press “Schedule publishing”.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-ink-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Platform</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">When</th>
                      <th className="px-2 py-2 font-medium">Result</th>
                      <th className="px-4 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {jobs.map((job) => (
                      <tr key={job.id} className="align-top">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <PlatformMark id={job.platformId} name={job.platformName} size="sm" />
                            <div>
                              <div className="text-[12px] text-ink-100">{job.platformName}</div>
                              <div className="text-[10px] text-ink-500">{job.accountName ?? 'no account'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <StatusBadge status={job.status} />
                          {job.errorCode === 'auth_expired' ? (
                            <div className="mt-1"><Badge tone="red">CONNECTION EXPIRED</Badge></div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2.5 text-[11px] text-ink-400">
                          {formatInZone(job.scheduledAt, campaign.timezone)}
                          {job.retryInMinutes !== null && job.status === 'scheduled' ? (
                            <div className="text-[10px] text-warn">retry in ~{job.retryInMinutes}m</div>
                          ) : null}
                        </td>
                        <td className="max-w-[240px] px-2 py-2.5">
                          {job.publishedUrl ? (
                            <a href={job.publishedUrl} target="_blank" rel="noreferrer noopener" className="text-[11px] text-gold-300 hover:text-gold-200">
                              View post ↗
                            </a>
                          ) : (
                            <span className="text-[11px] text-ink-400">{job.error ? job.error.slice(0, 130) : 'Queued'}</span>
                          )}
                          {job.attempts > 0 ? <div className="mt-0.5 text-[10px] text-ink-500">attempts: {job.attempts}</div> : null}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {job.status !== 'published' ? (
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={busy === `retry:${job.id}`}
                                onClick={() => act(`retry:${job.id}`, () => api(`/api/jobs/${job.id}/action`, { method: 'POST', body: { action: 'retry' } }), 'Retry requested')}
                              >
                                Retry
                              </Button>
                              {job.status === 'scheduled' ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={busy === `cancel:${job.id}`}
                                  onClick={() => act(`cancel:${job.id}`, () => api(`/api/jobs/${job.id}/action`, { method: 'POST', body: { action: 'cancel' } }), 'Job cancelled')}
                                >
                                  Cancel
                                </Button>
                              ) : null}
                              {job.errorCode === 'duplicate_prevented' ? (
                                <Button
                                  size="sm"
                                  variant="gold"
                                  loading={busy === `force:${job.id}`}
                                  onClick={() => act(`force:${job.id}`, () => api(`/api/jobs/${job.id}/action`, { method: 'POST', body: { action: 'force' } }), 'Publishing again (duplicate override)')}
                                >
                                  Publish anyway
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[10.5px] text-ok">done</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-3 border-t border-white/[0.05] px-4 py-2.5 text-[11px] text-ink-500">
              <span>{progress.published ?? 0} published</span>
              <span>·</span>
              <span>{progress.scheduled ?? 0} scheduled</span>
              <span>·</span>
              <span>{(progress.failed ?? 0) + (progress.connection_expired ?? 0)} failed</span>
              <span>·</span>
              <span>{progress.manual_required ?? 0} need an account</span>
            </div>
          </Card>

          {manualTasks.length ? (
            <Card>
              <CardHeader title="Manual publishing" subtitle="This campaign includes assisted platforms." icon={<FileText size={16} />} />
              <div className="divide-y divide-white/[0.05]">
                {manualTasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between px-4 py-2.5 text-[12px]">
                    <span className="text-ink-200">{task.platformName}</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={task.status} />
                      <Link href="/dashboard/manual" className="text-[11px] text-gold-300 hover:text-gold-200">Open queue</Link>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <button onClick={() => setShowLogs((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span className="flex items-center gap-2 text-[13px] font-medium text-ink-200">
                <History size={15} className="text-gold-400" /> Publishing log
                <Badge tone="neutral">{logs.length}</Badge>
              </span>
              <ChevronDown size={15} className={cn('text-ink-400 transition-transform', showLogs && 'rotate-180')} />
            </button>
            {showLogs ? (
              <div className="max-h-72 overflow-y-auto border-t border-white/[0.06] px-4 py-3 font-mono text-[10.5px] leading-relaxed">
                {logs.length === 0 ? (
                  <div className="text-ink-500">No log entries yet.</div>
                ) : (
                  logs.map((entry) => (
                    <div key={entry.id} className="flex gap-2 border-b border-white/[0.03] py-1 last:border-0">
                      <span className="shrink-0 text-ink-500">{new Date(entry.created_at).toLocaleTimeString()}</span>
                      <span
                        className={cn(
                          'shrink-0 uppercase',
                          entry.level === 'error' ? 'text-danger' : entry.level === 'warn' ? 'text-warn' : 'text-ink-500'
                        )}
                      >
                        {entry.step}
                      </span>
                      <span className="text-ink-300">{entry.message}</span>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-500">Approval</div>
            <div className="mt-2 flex items-end justify-between">
              <div className="text-[26px] font-semibold text-ink-100">
                {approvedCount}
                <span className="text-[14px] text-ink-500">/{total}</span>
              </div>
              <Badge tone={approvedCount === total && total > 0 ? 'green' : 'amber'}>
                {approvedCount === total && total > 0 ? 'Ready' : 'Needs review'}
              </Badge>
            </div>
            <div className="mt-2"><ProgressBar value={approvedCount} total={total} tone={approvedCount === total ? 'green' : 'gold'} /></div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
              Only approved platforms can be scheduled. You can still edit after approval.
            </p>
          </Card>

          <Card className="p-4">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-500">Platforms</div>
            <div className="mt-2.5 space-y-1.5">
              {contents.slice(0, 8).map((content) => (
                <div key={content.id} className="flex items-center gap-2">
                  <PlatformMark id={content.platformId} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-300">{content.platformName}</span>
                  {content.status === 'approved' ? <Check size={12} className="text-ok" /> : <Clock size={12} className="text-ink-500" />}
                </div>
              ))}
              {contents.length > 8 ? <div className="pt-1 text-[10.5px] text-ink-500">+{contents.length - 8} more</div> : null}
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-500">Danger zone</div>
            <div className="mt-2.5 space-y-2">
              <Button
                variant="secondary"
                className="w-full justify-start"
                size="sm"
                icon={<X size={13} />}
                loading={busy === 'cancel-campaign'}
                onClick={() =>
                  act('cancel-campaign', () => api(`/api/campaigns/${campaignId}/status`, { method: 'POST', body: { action: 'cancel' } }), 'Campaign cancelled')
                }
              >
                Cancel campaign & jobs
              </Button>
              <Button
                variant="danger"
                className="w-full justify-start"
                size="sm"
                icon={<Trash2 size={13} />}
                loading={busy === 'delete'}
                onClick={async () => {
                  if (!confirm('Delete this campaign? Media stays in your library. This cannot be undone.')) return;
                  await act('delete', async () => {
                    await api(`/api/campaigns/${campaignId}?force=1`, { method: 'DELETE' });
                    window.location.href = '/dashboard';
                  });
                }}
              >
                Delete campaign
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Compare modal */}
      <Modal open={Boolean(compare)} onClose={() => setCompare(null)} title={`Original vs ${compare?.name ?? ''} version`} wide>
        {compare ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-ink-500">Original (unchanged)</div>
              <div className="overflow-hidden rounded-xl border border-white/[0.08]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={compare.media.fileUrl} alt="Original" className="w-full" />
              </div>
              <div className="mt-1 text-[10.5px] text-ink-500">
                {compare.media.width}×{compare.media.height} · {(compare.media.bytes / 1024).toFixed(0)} KB
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-wider text-ink-500">
                <span>{compare.name} optimised</span>
                <a
                  href={`/api/media/${compare.media.id}/file?variant=${compare.platform}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gold-400 hover:text-gold-300"
                >
                  open
                </a>
              </div>
              <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-obsidian-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${compare.media.id}/file?variant=${compare.platform}`} alt="Platform version" className="w-full" />
              </div>
              <div className="mt-1 text-[10.5px] text-ink-500">
                The full poster is contained inside the platform canvas — never cropped or stretched.
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        campaignId={campaignId}
        timezone={campaign.timezone}
        contents={contents}
        recurrence={campaign.recurrence}
        onDone={async (summary) => {
          setScheduleOpen(false);
          push(summary, 'success');
          await load();
        }}
      />
    </div>
  );
}

function ScheduleModal({
  open,
  onClose,
  campaignId,
  timezone,
  contents,
  recurrence,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  timezone: string;
  contents: Content[];
  recurrence: string;
  onDone: (summary: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishNow, setPublishNow] = useState(true);
  const [when, setWhen] = useState('');
  const [tz, setTz] = useState(timezone || 'Asia/Kolkata');
  const [recur, setRecur] = useState(recurrence === 'none' ? 'none' : recurrence);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | null
    | {
        scheduled: { platformId: string; kind: string; status: string; message?: string }[];
        outcomes: { platformId: string; status: string; message: string }[];
      }
  >(null);
  const { push } = useToast();

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(contents.filter((c) => c.status === 'approved').map((c) => c.platformId)));
    setWhen(utcToLocalInput(new Date(Date.now() + 60 * 60_000).toISOString(), tz));
    setResult(null);
  }, [open, contents]); // eslint-disable-line react-hooks/exhaustive-deps

  const approved = contents.filter((c) => c.status === 'approved');

  async function submit() {
    if (!selected.size) {
      push('Select at least one approved platform.', 'error');
      return;
    }
    setBusy(true);
    try {
      const scheduledAt = publishNow ? null : zonedToUtc(when, tz);
      const data = await api<{
        scheduled: { platformId: string; kind: string; status: string; message?: string }[];
        outcomes: { platformId: string; status: string; message: string }[];
      }>(`/api/campaigns/${campaignId}/schedule`, {
        method: 'POST',
        body: {
          platforms: [...selected],
          publishNow,
          scheduledAt,
          timezone: tz,
          recurrence: recur,
          requireApproved: true,
        },
      });
      setResult(data);
      const published = data.outcomes?.filter((o) => o.status === 'published').length ?? 0;
      const queued = data.scheduled.filter((s) => s.kind === 'job' && s.status === 'scheduled').length;
      const manual = data.scheduled.filter((s) => s.kind === 'manual').length;
      const needsAccount = data.scheduled.filter((s) => s.kind === 'job' && s.status === 'manual_required').length;
      if (publishNow) {
        onDone(`Publishing attempted · ${published} published, ${needsAccount} need an account, ${manual} manual packages`);
      } else {
        onDone(`Scheduled ${queued} job(s)${manual ? ` · ${manual} manual package(s)` : ''}${needsAccount ? ` · ${needsAccount} need an account` : ''}`);
      }
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule publishing"
      wide
      footer={
        result ? (
          <div className="flex justify-end">
            <Button variant="gold" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-ink-500">{selected.size} of {approved.length} approved platforms selected</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="gold" loading={busy} onClick={submit} icon={<Send size={14} />}>
                {publishNow ? 'Publish now' : 'Schedule'}
              </Button>
            </div>
          </div>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone="green" title="Publishing jobs recorded">
            Every row below is a real job in the database. Failures are kept and explained — nothing is marked
            published without a platform response.
          </Notice>
          <div className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.07]">
            {result.scheduled.map((item) => {
              const outcome = result.outcomes.find((o) => o.platformId === item.platformId);
              const content = contents.find((c) => c.platformId === item.platformId);
              return (
                <div key={item.platformId} className="flex items-start gap-2 px-3 py-2.5">
                  <PlatformMark id={item.platformId} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-ink-100">{content?.platformName}</div>
                    <div className="text-[11px] text-ink-400">
                      {outcome ? outcome.message : item.kind === 'manual' ? 'Manual package queued — see Manual Queue.' : item.message ?? 'Job created'}
                    </div>
                  </div>
                  <StatusBadge status={outcome?.status ?? item.status} />
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-ink-500">
            Tip: platforms showing “Manual Action Required” need a connected account, or use the manual package.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {approved.length === 0 ? (
            <Notice tone="amber" title="No approved content">
              Approve at least one platform before scheduling.
            </Notice>
          ) : null}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="field-label mb-0">Platforms</span>
              <div className="flex gap-2 text-[11px]">
                <button className="text-gold-300 hover:text-gold-200" onClick={() => setSelected(new Set(approved.map((c) => c.platformId)))}>All approved</button>
                <span className="text-ink-600">·</span>
                <button className="text-ink-400 hover:text-ink-200" onClick={() => setSelected(new Set(approved.filter((c) => c.automation !== 'manual').map((c) => c.platformId)))}>API only</button>
                <span className="text-ink-600">·</span>
                <button className="text-ink-400 hover:text-ink-200" onClick={() => setSelected(new Set(approved.filter((c) => c.automation === 'manual').map((c) => c.platformId)))}>Manual only</button>
              </div>
            </div>
            <div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-xl border border-white/[0.07] p-2 sm:grid-cols-2">
              {approved.map((content) => {
                const active = selected.has(content.platformId);
                return (
                  <button
                    key={content.platformId}
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(content.platformId)) next.delete(content.platformId);
                        else next.add(content.platformId);
                        return next;
                      })
                    }
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[11.5px]',
                      active ? 'border-gold-500/40 bg-gold-500/[0.07] text-ink-100' : 'border-transparent text-ink-400 hover:bg-white/[0.04]'
                    )}
                  >
                    <PlatformMark id={content.platformId} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{content.platformName}</span>
                    {content.automation === 'manual' ? <Badge tone="purple">manual</Badge> : null}
                    {active ? <Check size={12} className="text-gold-300" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Timing">
              <Select value={publishNow ? 'now' : 'later'} onChange={(e) => setPublishNow(e.target.value === 'now')}>
                <option value="now">Publish immediately</option>
                <option value="later">Schedule for later</option>
              </Select>
            </Field>
            <Field label="Timezone">
              <Select value={tz} onChange={(e) => { setTz(e.target.value); setWhen(utcToLocalInput(new Date(Date.now() + 3600_000).toISOString(), e.target.value)); }}>
                {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'].map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </Select>
            </Field>
            {!publishNow ? (
              <Field label="Date & time" hint={`Interpreted in ${tz}`}>
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
            ) : null}
            <Field label="Repeat">
              <Select value={recur} onChange={(e) => setRecur(e.target.value)}>
                <option value="none">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </Select>
            </Field>
          </div>

          {recur !== 'none' ? (
            <Notice tone="amber">
              Recurring cycles re-queue the approved content. Identical copy is blocked by duplicate detection for
              your configured window ({'{Settings → Publishing}'}) so the same poster is not spammed daily — you will
              see those jobs as cancelled with a duplicate explanation.
            </Notice>
          ) : null}

          <div className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
            Publishing uses official APIs only. Platforms without a connected account are recorded as “manual
            action required” rather than silently skipped.
          </div>
        </div>
      )}
    </Modal>
  );
}
