'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BellRing,
  Building2,
  DatabaseBackup,
  Inbox,
  MailCheck,
  Plus,
  RefreshCw,
  Rss,
  Trash2,
  Workflow,
} from 'lucide-react';
import { api, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Select, Spinner, cn, useToast } from '@/components/ui';

interface AlertsPayload {
  config: { enabled: boolean; channels: string[]; configured: boolean; chatId: string | null; email: string | null; webhookUrl: string | null; telegramToken: boolean };
  events: { id: string; code: string; severity: string; title: string; detail: string; channel: string; delivered: boolean; error: string | null; createdAt: string }[];
  triggers: { code: string; when: string }[];
}

interface SnapshotPayload {
  config: { configured: boolean; schedule: 'off' | 'daily' | 'weekly'; retention: number };
  snapshots: { id: string; fileName: string; bytes: number; trigger: string; tables: Record<string, number>; createdAt: string }[];
  note: string;
}

interface RssPayload {
  feeds: { id: string; url: string; label: string; enabled: boolean; autoGenerate: boolean; lastCheckedAt: string | null; lastError: string | null; itemCount: number; draftedCount: number }[];
  items: { id: string; title: string; link: string; state: string; error: string | null; campaignId: string | null; campaignName: string | null; createdAt: string }[];
  note: string;
}

interface WarmupPayload {
  warmup: { rampEnabled: boolean; rampStart: number; rampIncrement: number; rampMax: number; dailyLimit: number; sentToday: number; remaining: number; canSend: boolean; day: string; note: string; rampStartedAt: string | null };
  workspaceId: string;
}

interface ImapPayload {
  imap: { enabled: boolean; host: string; port: number; user: string; hasPassword: boolean; lastPollAt: string | null; lastError: string | null };
  replies: { id: string; from: string; subject: string; snippet: string; receivedAt: string; pausedFollowups: number }[];
}

interface WorkspacePayload {
  activeId: string;
  workspaces: { id: string; name: string; active: boolean; stats: { campaigns: number; accounts: number; media: number } }[];
}

function when(iso: string | null | undefined) {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function kb(bytes: number) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function AutomationView() {
  const { push } = useToast();
  const [alerts, setAlerts] = useState<AlertsPayload | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotPayload | null>(null);
  const [rss, setRss] = useState<RssPayload | null>(null);
  const [warmup, setWarmup] = useState<WarmupPayload | null>(null);
  const [imap, setImap] = useState<ImapPayload | null>(null);
  const [spaces, setSpaces] = useState<WorkspacePayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [telegram, setTelegram] = useState({ token: '', chat: '' });
  const [alertEmail, setAlertEmail] = useState('');
  const [webhook, setWebhook] = useState('');
  const [snapPass, setSnapPass] = useState('');
  const [snapSchedule, setSnapSchedule] = useState<'off' | 'daily' | 'weekly'>('off');
  const [feedUrl, setFeedUrl] = useState('');
  const [newWorkspace, setNewWorkspace] = useState('');
  const [imapForm, setImapForm] = useState({ host: '', port: '993', user: '', pass: '' });
  const [ramp, setRamp] = useState({ enabled: true, start: '5', increment: '3', max: '50' });

  const load = useCallback(async () => {
    try {
      const [a, s, r, w, i, ws] = await Promise.all([
        api<AlertsPayload>('/api/alerts'),
        api<SnapshotPayload>('/api/snapshots'),
        api<RssPayload>('/api/rss'),
        api<WarmupPayload>('/api/email/warmup'),
        api<ImapPayload>('/api/email/imap'),
        api<WorkspacePayload>('/api/workspaces'),
      ]);
      setAlerts(a);
      setSnapshots(s);
      setRss(r);
      setWarmup(w);
      setImap(i);
      setSpaces(ws);
      setSnapSchedule(s.config.schedule);
      setAlertEmail(a.config.email ?? '');
      setWebhook(a.config.webhookUrl ?? '');
      setRamp({
        enabled: w.warmup.rampEnabled,
        start: String(w.warmup.rampStart),
        increment: String(w.warmup.rampIncrement),
        max: String(w.warmup.rampMax),
      });
      setImapForm((prev) => ({
        host: i.imap.host || prev.host,
        port: String(i.imap.port || prev.port),
        user: i.imap.user || prev.user,
        pass: '',
      }));
    } catch (err) {
      push((err as Error).message, 'error');
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (!alerts || !snapshots || !rss || !warmup || !imap || !spaces) {
    return (
      <div className="py-12">
        <Spinner label="Loading automation state…" />
      </div>
    );
  }

  const active = spaces.workspaces.find((w) => w.active);

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Automation & alerts"
        description="Background supervision, external alerts, encrypted snapshots, feed ingestion, evergreen recycling and email warm-up — all scoped to the active workspace."
        actions={
          <Button variant="secondary" onClick={() => void load()} icon={<RefreshCw size={14} />}>
            Refresh
          </Button>
        }
      />

      <div className="space-y-4">
        {/* ── workspaces */}
        <Card>
          <CardHeader
            title="Workspaces"
            subtitle="Each workspace has its own business identity, platform accounts, sender identity, campaigns and calendar."
            icon={<Building2 size={16} />}
          />
          <div className="space-y-3 px-5 py-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {spaces.workspaces.map((w) => (
                <div
                  key={w.id}
                  className={cn(
                    'rounded-lg border px-3 py-2.5',
                    w.active ? 'border-gold-500/40 bg-gold-500/[0.06]' : 'border-white/[0.07] bg-white/[0.02]'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] text-ink-100">{w.name}</span>
                    {w.active ? <Badge tone="gold">active</Badge> : null}
                  </div>
                  <div className="mt-1 text-[10.5px] text-ink-500">
                    {w.stats.campaigns} campaigns · {w.stats.accounts} accounts · {w.stats.media} media
                  </div>
                  {!w.active ? (
                    <button
                      className="mt-1.5 text-[11px] text-gold-300 hover:underline"
                      onClick={() => void run(`switch:${w.id}`, async () => {
                        await api('/api/workspaces', { method: 'PATCH', body: { activeId: w.id } });
                        push(`Switched to ${w.name}`, 'success');
                        window.location.reload();
                      })}
                    >
                      Switch to this workspace
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="New workspace">
                <Input value={newWorkspace} onChange={(e) => setNewWorkspace(e.target.value)} placeholder="Client: Spice Route Restaurant" />
              </Field>
              <Button
                variant="gold"
                icon={<Plus size={14} />}
                loading={busy === 'workspace'}
                onClick={() => void run('workspace', async () => {
                  await api('/api/workspaces', { method: 'POST', body: { name: newWorkspace } });
                  setNewWorkspace('');
                  push('Workspace created — switch to it to configure its accounts', 'success');
                })}
              >
                Create workspace
              </Button>
            </div>
            <Notice tone="neutral">
              Active workspace: <strong>{active?.name ?? '—'}</strong>. Platform accounts, campaigns and the email sender
              identity are isolated per workspace; the operator account, audit log and diagnostics are shared.
            </Notice>
          </div>
        </Card>

        {/* ── alerts */}
        <Card>
          <CardHeader
            title="External alerts"
            subtitle="Critical failures leave the dashboard: worker stopped, token expired, retries exhausted, snapshot or feed failure."
            icon={<BellRing size={16} />}
          />
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={alerts.config.enabled ? 'green' : 'neutral'} dot>
                {alerts.config.enabled ? 'enabled' : 'disabled'}
              </Badge>
              {alerts.config.channels.length ? (
                alerts.config.channels.map((c) => <Badge key={c} tone="gold">{c}</Badge>)
              ) : (
                <Badge tone="amber">no channel configured</Badge>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Telegram bot token" hint={alerts.config.telegramToken ? 'A token is stored. Enter a new one to replace it.' : 'From @BotFather'}>
                <Input type="password" value={telegram.token} onChange={(e) => setTelegram({ ...telegram, token: e.target.value })} placeholder="123456:ABC…" />
              </Field>
              <Field label="Telegram chat ID" hint={alerts.config.chatId ? `Currently ${alerts.config.chatId}` : 'Send /start to the bot, then use @userinfobot'}>
                <Input value={telegram.chat} onChange={(e) => setTelegram({ ...telegram, chat: e.target.value })} placeholder="-1001234567890" />
              </Field>
              <Field label="Alert email">
                <Input value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} placeholder="ops@yourdomain.in" />
              </Field>
              <Field label="Webhook URL (optional)" hint="Any https endpoint accepting a JSON POST.">
                <Input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.example.com/royalweb" />
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="gold"
                loading={busy === 'alerts-save'}
                onClick={() => void run('alerts-save', async () => {
                  await api('/api/alerts', {
                    method: 'POST',
                    body: {
                      telegramBotToken: telegram.token || undefined,
                      telegramChatId: telegram.chat || undefined,
                      email: alertEmail,
                      webhookUrl: webhook,
                      enabled: true,
                    },
                  });
                  setTelegram({ token: '', chat: '' });
                  push('Alert channels saved', 'success');
                })}
              >
                Save channels
              </Button>
              <Button
                variant="secondary"
                loading={busy === 'alerts-test'}
                onClick={() => void run('alerts-test', async () => {
                  const res = await api<{ result: { channels: { channel: string; ok: boolean; detail: string }[] } }>('/api/alerts', {
                    method: 'PUT',
                    body: { test: true },
                  });
                  const summary = res.result.channels.map((c) => `${c.channel}: ${c.ok ? 'ok' : c.detail}`).join(' · ');
                  push(summary || 'No channel configured', res.result.channels.some((c) => c.ok) ? 'success' : 'error');
                })}
              >
                Send test alert
              </Button>
            </div>

            <div className="grid gap-1.5 sm:grid-cols-2">
              {alerts.triggers.map((t) => (
                <div key={t.code} className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
                  <div className="font-mono text-[10.5px] text-gold-300">{t.code}</div>
                  <div className="text-[11px] text-ink-400">{t.when}</div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-white/[0.06]">
              {alerts.events.length === 0 ? (
                <div className="px-3 py-4 text-[11.5px] text-ink-500">No alerts have fired yet.</div>
              ) : (
                alerts.events.slice(0, 8).map((e) => (
                  <div key={e.id} className="border-b border-white/[0.05] px-3 py-2 last:border-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={e.delivered ? 'green' : e.severity === 'critical' ? 'red' : 'amber'}>
                        {e.delivered ? 'delivered' : 'not delivered'}
                      </Badge>
                      <span className="text-[11.5px] text-ink-200">{e.title}</span>
                      <span className="text-[10px] text-ink-500">{when(e.createdAt)}</span>
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-ink-500">
                      {e.code} · {e.channel || 'none'}
                      {e.error ? ` · ${e.error}` : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>

        {/* ── snapshots */}
        <Card>
          <CardHeader
            title="Encrypted database snapshots"
            subtitle="Whole-database copies (campaigns, jobs, published history, analytics, opt-outs) encrypted with a passphrase-derived key."
            icon={<DatabaseBackup size={16} />}
          />
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={snapshots.config.configured ? 'green' : 'amber'}>
                {snapshots.config.configured ? 'passphrase set' : 'no passphrase'}
              </Badge>
              <Badge tone="neutral">schedule: {snapshots.config.schedule}</Badge>
              <Badge tone="neutral">keep {snapshots.config.retention}</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Passphrase (min 12)" hint="Needed to restore. Stored encrypted; never shown again.">
                <Input type="password" value={snapPass} onChange={(e) => setSnapPass(e.target.value)} />
              </Field>
              <Field label="Schedule">
                <Select value={snapSchedule} onChange={(e) => setSnapSchedule(e.target.value as 'off' | 'daily' | 'weekly')}>
                  <option value="off">Off</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  className="w-full"
                  loading={busy === 'snap-config'}
                  onClick={() => void run('snap-config', async () => {
                    await api('/api/snapshots', {
                      method: 'POST',
                      body: { action: 'config', passphrase: snapPass || undefined, schedule: snapSchedule },
                    });
                    setSnapPass('');
                    push('Snapshot schedule saved', 'success');
                  })}
                >
                  Save schedule
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="gold"
                loading={busy === 'snap-create'}
                onClick={() => void run('snap-create', async () => {
                  const res = await api<{ result: { fileName?: string; bytes?: number } }>('/api/snapshots', {
                    method: 'POST',
                    body: { action: 'create', passphrase: snapPass || undefined },
                  });
                  push(`Snapshot written: ${res.result.fileName} (${kb(res.result.bytes ?? 0)})`, 'success');
                  setSnapPass('');
                })}
              >
                Take snapshot now
              </Button>
            </div>
            <div className="rounded-lg border border-white/[0.06]">
              {snapshots.snapshots.length === 0 ? (
                <div className="px-3 py-4 text-[11.5px] text-ink-500">No snapshots yet.</div>
              ) : (
                snapshots.snapshots.slice(0, 6).map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] px-3 py-2 last:border-0">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] text-ink-200">{s.fileName}</div>
                      <div className="text-[10px] text-ink-500">
                        {when(s.createdAt)} · {kb(s.bytes)} · {s.trigger} · {Object.values(s.tables).reduce((a, b) => a + b, 0)} rows
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <a
                        href={`/api/snapshots/${s.id}`}
                        className="rounded-md border border-white/[0.08] px-2 py-1 text-[10.5px] text-ink-300 hover:bg-white/[0.04]"
                      >
                        Download
                      </a>
                      <button
                        className="rounded-md border border-danger/25 px-2 py-1 text-[10.5px] text-danger hover:bg-danger/10"
                        onClick={() => void run(`snap-del:${s.id}`, async () => {
                          await api('/api/snapshots', { method: 'DELETE', body: { id: s.id } });
                          push('Snapshot deleted', 'success');
                        })}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <Notice tone="neutral">{snapshots.note}</Notice>
          </div>
        </Card>

        {/* ── rss */}
        <Card>
          <CardHeader
            title="RSS / blog ingestion"
            subtitle="New articles become draft campaigns with 25 drafts, held for approval."
            icon={<Rss size={16} />}
          />
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Feed URL">
                <Input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://yourblog.com/rss.xml" />
              </Field>
              <Button
                variant="gold"
                icon={<Plus size={14} />}
                loading={busy === 'feed-add'}
                onClick={() => void run('feed-add', async () => {
                  const res = await api<{ ingest: { newItems: number; drafted: number; error?: string } }>('/api/rss', {
                    method: 'POST',
                    body: { action: 'add', url: feedUrl },
                  });
                  setFeedUrl('');
                  push(
                    res.ingest?.error
                      ? `Feed added, first poll failed: ${res.ingest.error}`
                      : `Feed added · ${res.ingest?.newItems ?? 0} new item(s) · ${res.ingest?.drafted ?? 0} drafted`,
                    res.ingest?.error ? 'error' : 'success'
                  );
                })}
              >
                Add & poll now
              </Button>
            </div>

            {rss.feeds.length === 0 ? (
              <EmptyState title="No feeds yet" description="Add a blog or news feed to draft content automatically." />
            ) : (
              <div className="space-y-1.5">
                {rss.feeds.map((f) => (
                  <div key={f.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="truncate font-mono text-[11px] text-ink-200">{f.label || f.url}</span>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={f.lastError ? 'red' : 'green'}>{f.lastError ? 'error' : 'ok'}</Badge>
                        <span className="text-[10px] text-ink-500">{f.itemCount} items · {f.draftedCount} drafted</span>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busy === `feed:${f.id}`}
                          onClick={() => void run(`feed:${f.id}`, async () => {
                            const res = await api<{ ingest: { newItems: number; drafted: number; error?: string } }>('/api/rss', {
                              method: 'POST',
                              body: { action: 'ingest', feedId: f.id },
                            });
                            push(
                              res.ingest.error ?? `${res.ingest.newItems} new · ${res.ingest.drafted} drafted`,
                              res.ingest.error ? 'error' : 'success'
                            );
                          })}
                        >
                          Poll
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 size={11} />}
                          onClick={() => void run(`feed-rm:${f.id}`, async () => {
                            await api('/api/rss', { method: 'POST', body: { action: 'remove', feedId: f.id } });
                            push('Feed removed', 'success');
                          })}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                    {f.lastError ? <div className="mt-1 text-[10.5px] text-danger/90">{f.lastError}</div> : null}
                    <div className="mt-0.5 text-[10px] text-ink-500">checked {when(f.lastCheckedAt)}</div>
                  </div>
                ))}
              </div>
            )}

            {rss.items.length ? (
              <div className="rounded-lg border border-white/[0.06]">
                {rss.items.slice(0, 6).map((i) => (
                  <div key={i.id} className="border-b border-white/[0.05] px-3 py-2 last:border-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={i.state === 'drafted' ? 'green' : i.state === 'failed' ? 'red' : 'neutral'}>{i.state}</Badge>
                      <span className="text-[11.5px] text-ink-200">{i.title || i.link}</span>
                    </div>
                    {i.error ? <div className="text-[10.5px] text-warn">{i.error}</div> : null}
                    {i.campaignName ? (
                      <div className="text-[10.5px] text-ink-500">→ draft campaign “{i.campaignName}”</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <Notice tone="neutral">{rss.note}</Notice>
          </div>
        </Card>

        {/* ── email warm-up + imap */}
        <Card>
          <CardHeader
            title="Email warm-up & reply detection"
            subtitle="A new domain ramps from a few sends a day; a reply pauses the follow-up sequence for that lead."
            icon={<MailCheck size={16} />}
          />
          <div className="space-y-3 px-5 py-4">
            <div className="grid gap-2 sm:grid-cols-4">
              <Stat label="Daily limit" value={String(warmup.warmup.dailyLimit)} />
              <Stat label="Sent today" value={String(warmup.warmup.sentToday)} />
              <Stat label="Remaining" value={String(warmup.warmup.remaining)} />
              <Stat label="Ramp started" value={warmup.warmup.rampStartedAt ? when(warmup.warmup.rampStartedAt).slice(0, 10) : 'not yet'} />
            </div>
            <Notice tone={warmup.warmup.canSend ? 'green' : 'amber'}>{warmup.warmup.note}</Notice>

            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Ramp start / day">
                <Input value={ramp.start} onChange={(e) => setRamp({ ...ramp, start: e.target.value })} />
              </Field>
              <Field label="+ per day">
                <Input value={ramp.increment} onChange={(e) => setRamp({ ...ramp, increment: e.target.value })} />
              </Field>
              <Field label="Cap / day">
                <Input value={ramp.max} onChange={(e) => setRamp({ ...ramp, max: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <Button
                  variant="secondary"
                  className="w-full"
                  loading={busy === 'ramp'}
                  onClick={() => void run('ramp', async () => {
                    await api('/api/email/warmup', {
                      method: 'POST',
                      body: {
                        rampEnabled: ramp.enabled,
                        rampStart: Number(ramp.start),
                        rampIncrement: Number(ramp.increment),
                        rampMax: Number(ramp.max),
                      },
                    });
                    push('Warm-up schedule updated', 'success');
                  })}
                >
                  Save ramp
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="IMAP host">
                <Input value={imapForm.host} onChange={(e) => setImapForm({ ...imapForm, host: e.target.value })} placeholder="imap.gmail.com" />
              </Field>
              <Field label="Port">
                <Input value={imapForm.port} onChange={(e) => setImapForm({ ...imapForm, port: e.target.value })} />
              </Field>
              <Field label="Username">
                <Input value={imapForm.user} onChange={(e) => setImapForm({ ...imapForm, user: e.target.value })} />
              </Field>
              <Field label="Password / app password" hint={imap.imap.hasPassword ? 'Stored — enter to replace' : undefined}>
                <Input type="password" value={imapForm.pass} onChange={(e) => setImapForm({ ...imapForm, pass: e.target.value })} />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                loading={busy === 'imap-save'}
                onClick={() => void run('imap-save', async () => {
                  await api('/api/email/imap', {
                    method: 'POST',
                    body: {
                      action: 'configure',
                      enabled: true,
                      host: imapForm.host,
                      port: Number(imapForm.port),
                      user: imapForm.user,
                      pass: imapForm.pass || undefined,
                    },
                  });
                  setImapForm({ ...imapForm, pass: '' });
                  push('IMAP settings saved', 'success');
                })}
              >
                Save IMAP
              </Button>
              <Button
                variant="gold"
                icon={<Inbox size={13} />}
                loading={busy === 'imap-poll'}
                onClick={() => void run('imap-poll', async () => {
                  const res = await api<{ result: { ok: boolean; newReplies: number; pausedFollowups: number; error?: string } }>('/api/email/imap', {
                    method: 'POST',
                    body: { action: 'poll' },
                  });
                  push(
                    res.result.ok
                      ? `${res.result.newReplies} reply(s) found · ${res.result.pausedFollowups} follow-up(s) paused`
                      : res.result.error ?? 'IMAP poll failed',
                    res.result.ok ? 'success' : 'error'
                  );
                })}
              >
                Check inbox now
              </Button>
              <span className="text-[11px] text-ink-500">Last poll: {when(imap.imap.lastPollAt)}</span>
            </div>
            {imap.imap.lastError ? <Notice tone="red">{imap.imap.lastError}</Notice> : null}

            {imap.replies.length ? (
              <div className="rounded-lg border border-white/[0.06]">
                {imap.replies.slice(0, 6).map((r) => (
                  <div key={r.id} className="border-b border-white/[0.05] px-3 py-2 last:border-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="green">reply</Badge>
                      <span className="text-[11.5px] text-ink-200">{r.from}</span>
                      <span className="text-[10px] text-ink-500">{when(r.receivedAt)}</span>
                      {r.pausedFollowups ? <Badge tone="amber">{r.pausedFollowups} paused</Badge> : null}
                    </div>
                    <div className="text-[10.5px] text-ink-400">{r.subject}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-ink-500">No replies detected yet.</div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Evergreen recycling" subtitle="Re-queue a finished campaign later with a light variation — always as a draft." icon={<Workflow size={16} />} />
          <div className="px-5 py-4 text-[11.5px] leading-relaxed text-ink-400">
            Open a completed campaign and choose <span className="text-ink-200">Recycle after 60–90 days</span>. The clone is
            created as a draft with new copy (labelled <span className="font-mono text-ink-300">recycled</span>), never
            republished verbatim, and never published without approval. Set the window from the campaign page or{' '}
            <span className="font-mono text-ink-300">POST /api/campaigns/&lt;id&gt;/recycle</span>.
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-ink-100">{value}</div>
    </div>
  );
}
