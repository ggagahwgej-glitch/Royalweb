'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Download, ExternalLink, FileText, PenLine, SkipForward } from 'lucide-react';
import {
  api,
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  Notice,
  PageHeader,
  Spinner,
  StatusBadge,
  Textarea,
  cn,
  useToast,
} from '@/components/ui';
import { PlatformMark } from '@/components/PlatformMark';
import { relativeTime } from '@/lib/time';

interface ManualTask {
  id: string;
  campaignId: string;
  campaignName?: string;
  platformId: string;
  platformName?: string;
  status: string;
  notes: string;
  completedAt: string | null;
  createdAt: string;
  content: {
    title: string;
    caption: string;
    description: string;
    hashtags: string[];
    cta: string;
    destinationUrl: string;
  } | null;
  media: { id: string; originalName: string; thumbUrl: string; fileUrl: string }[];
}

const PLATFORM_URLS: Record<string, string> = {
  behance: 'https://www.behance.net/',
  dribbble: 'https://dribbble.com/shots/new',
  quora: 'https://www.quora.com/',
  reddit: 'https://www.reddit.com/submit',
  indiamart: 'https://seller.indiamart.com/',
  justdial: 'https://www.justdial.com/',
  goodfirms: 'https://www.goodfirms.co/',
};

export function ManualCenter() {
  const { push } = useToast();
  const [tasks, setTasks] = useState<ManualTask[] | null>(null);
  const [filter, setFilter] = useState<'pending' | 'published' | 'all'>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ tasks: ManualTask[] }>(`/api/manual?status=${filter}`);
      setTasks(data.tasks);
      const initial: Record<string, string> = {};
      data.tasks.forEach((t) => (initial[t.id] = t.notes));
      setNotes(initial);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(task: ManualTask, status: string, note?: string) {
    setBusy(`${status}:${task.id}`);
    try {
      await api(`/api/manual/${task.id}`, {
        method: 'PATCH',
        body: { status, ...(note !== undefined ? { notes: note } : {}) },
      });
      push(
        status === 'published' ? `${task.platformName} marked as published` : status === 'skipped' ? 'Task skipped' : 'Saved',
        'success'
      );
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(
    () => ({
      pending: tasks?.filter((t) => t.status === 'pending').length ?? 0,
      published: tasks?.filter((t) => t.status === 'published').length ?? 0,
      total: tasks?.length ?? 0,
    }),
    [tasks]
  );

  return (
    <div>
      <PageHeader
        eyebrow="Assisted publishing"
        title="Manual publishing center"
        description="Complete, copy-ready packages for platforms without a supported publishing API. ROYALWEB never automates logins, CAPTCHAs or posting here — you publish, then mark it done."
        actions={
          <div className="flex gap-1.5">
            {(['pending', 'published', 'all'] as const).map((key) => (
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
                {key === 'pending' ? 'Pending' : key === 'published' ? 'Published' : 'All'}
              </button>
            ))}
          </div>
        }
      />

      {error ? <Notice tone="red">{error}</Notice> : null}

      <Card className="mb-4 p-3.5">
        <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500">Pending</div>
            <div className="text-[17px] font-semibold text-warn">{counts.pending}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500">Published</div>
            <div className="text-[17px] font-semibold text-ok">{counts.published}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500">Shown</div>
            <div className="text-[17px] font-semibold text-ink-100">{counts.total}</div>
          </div>
        </div>
      </Card>

      {!tasks ? (
        <div className="py-12"><Spinner label="Loading manual queue…" /></div>
      ) : tasks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PenLine size={22} />}
            title={filter === 'pending' ? 'Nothing waiting' : 'No manual tasks yet'}
            description="Manual tasks are created when you schedule a campaign that includes Group C platforms — Behance, Dribbble, Quora, Reddit, IndiaMART, Justdial or GoodFirms."
            action={<Link href="/dashboard/new" className="text-[12px] text-gold-300 hover:text-gold-200">Create a campaign →</Link>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const open = expanded === task.id;
            const content = task.content;
            return (
              <Card key={task.id} className="overflow-hidden">
                <div className="flex flex-wrap items-start gap-3 p-4">
                  <PlatformMark id={task.platformId} name={task.platformName} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13.5px] font-medium text-ink-100">{task.platformName}</span>
                      <StatusBadge status={task.status} />
                    </div>
                    <Link href={`/dashboard/campaigns/${task.campaignId}`} className="mt-0.5 block truncate text-[11.5px] text-ink-400 hover:text-gold-300">
                      {task.campaignName}
                    </Link>
                    <div className="mt-0.5 text-[10.5px] text-ink-500">
                      queued {relativeTime(task.createdAt)}
                      {task.completedAt ? ` · published ${relativeTime(task.completedAt)}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {task.media[0] ? (
                      <div className="hidden h-14 w-14 overflow-hidden rounded-lg border border-white/[0.08] sm:block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={task.media[0].thumbUrl} alt="" className="h-full w-full object-cover" />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.05] px-4 py-2.5">
                  <CopyButton value={content?.caption ?? ''} label="Copy caption" />
                  <CopyButton value={content?.title ?? ''} label="Copy title" />
                  <CopyButton value={(content?.hashtags ?? []).map((h) => `#${h.replace(/^#/, '')}`).join(' ')} label="Copy tags" />
                  <a
                    href={`/api/manual/${task.id}/package`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gold-500/40 px-3 py-1.5 text-[12px] text-gold-200 hover:bg-gold-500/10"
                  >
                    <Download size={13} /> Download package
                  </a>
                  <a
                    href={PLATFORM_URLS[task.platformId] ?? '#'}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.09] bg-white/[0.045] px-3 py-1.5 text-[12px] text-ink-100 hover:bg-white/[0.08]"
                  >
                    <ExternalLink size={12} /> Open platform
                  </a>
                  <div className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(open ? null : task.id)} icon={<FileText size={12} />}>
                      {open ? 'Hide copy' : 'View copy'}
                    </Button>
                    {task.status !== 'published' ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => update(task, 'skipped')} loading={busy === `skipped:${task.id}`} icon={<SkipForward size={12} />}>
                          Skip
                        </Button>
                        <Button
                          size="sm"
                          variant="gold"
                          loading={busy === `published:${task.id}`}
                          onClick={() => update(task, 'published', notes[task.id])}
                          icon={<CheckCircle2 size={12} />}
                        >
                          Mark as published
                        </Button>
                      </>
                    ) : (
                      <Badge tone="green">completed</Badge>
                    )}
                  </div>
                </div>

                {open ? (
                  <div className="space-y-3 border-t border-white/[0.05] bg-white/[0.012] px-4 py-3">
                    {content?.title ? (
                      <div>
                        <div className="field-label">Title</div>
                        <div className="rounded-lg border border-white/[0.07] bg-obsidian-900/60 p-2.5 text-[12px] text-ink-200">{content.title}</div>
                      </div>
                    ) : null}
                    <div>
                      <div className="field-label">Caption</div>
                      <div className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-obsidian-900/60 p-2.5 text-[12px] leading-relaxed text-ink-200">
                        {content?.caption || 'No caption generated yet. Generate content for this campaign.'}
                      </div>
                    </div>
                    {content?.description && content.description !== content.caption ? (
                      <div>
                        <div className="field-label">Description / article</div>
                        <div className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-obsidian-900/60 p-2.5 text-[12px] leading-relaxed text-ink-300">
                          {content.description}
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <div className="field-label">Notes (saved with the task)</div>
                      <Textarea
                        className="min-h-[70px]"
                        placeholder="e.g. Posted in r/webdev as a discussion, not promotional."
                        value={notes[task.id] ?? ''}
                        onChange={(e) => setNotes({ ...notes, [task.id]: e.target.value })}
                      />
                      <div className="mt-2">
                        <Button size="sm" variant="secondary" loading={busy === `pending:${task.id}`} onClick={() => update(task, task.status, notes[task.id])}>
                          Save note
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-5">
        <Notice tone="purple" title="Why no automation here?">
          Behance, Dribbble, Quora, Reddit, IndiaMART, Justdial and GoodFirms have no supported public publishing API
          for this use case, and browser automation would violate their terms. ROYALWEB prepares the copy, the
          platform-sized image and the instructions, and records what you publish.
        </Notice>
      </div>
    </div>
  );
}
