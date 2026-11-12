'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Play,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  Wrench,
} from 'lucide-react';
import {
  api,
  Badge,
  Button,
  Card,
  CardHeader,
  Modal,
  Notice,
  PageHeader,
  Spinner,
  cn,
  useToast,
} from '@/components/ui';
import { ERROR_GUIDES, guideFor } from '@/lib/errors/guide';
import { relativeTime } from '@/lib/time';

type CheckStatus = 'ok' | 'warn' | 'fail' | 'info';

interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  metric?: string;
}

interface Issue {
  id: string;
  code: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  meaning: string;
  why: string[];
  steps: string[];
  actions: { label: string; href?: string; repair?: string }[];
  count?: number;
  subjects?: string[];
  fix?: { action: string; label: string; confirm: string };
}

interface Report {
  status: 'healthy' | 'degraded' | 'critical';
  health: number;
  checks: Check[];
  issues: Issue[];
  counts: Record<string, number>;
  worker: { lastHeartbeatAt: string | null; secondsAgo: number | null; stalled: boolean; expectedIntervalSeconds: number };
  generatedAt: string;
}

const STATUS_TONE: Record<CheckStatus, 'green' | 'amber' | 'red' | 'blue'> = {
  ok: 'green',
  warn: 'amber',
  fail: 'red',
  info: 'blue',
};

const SEVERITY_TONE: Record<Issue['severity'], 'red' | 'amber' | 'blue'> = {
  critical: 'red',
  warning: 'amber',
  info: 'blue',
};

const TRAPS: { code: string; trap: string }[] = [
  { code: 'worker_stalled', trap: 'Scheduled posts never go out' },
  { code: 'connection_expired', trap: 'Platform suddenly rejects a token' },
  { code: 'no_account', trap: 'Content ready, nothing published' },
  { code: 'duplicate_prevented', trap: 'Post silently skipped as duplicate' },
  { code: 'rate_limited', trap: 'Platform refuses with 429' },
  { code: 'permission_denied', trap: 'Connected, but not allowed' },
  { code: 'public_url_missing', trap: 'Image missing on Blogger/Ghost/Pinterest' },
  { code: 'video_required', trap: 'YouTube Shorts refuses a poster' },
];

export function DiagnosticsView() {
  const { push } = useToast();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Issue['fix'] | null>(null);
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [openGuide, setOpenGuide] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api<Report>('/api/diagnostics'));
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  async function repair(action: string) {
    setBusy(action);
    setLastResult(null);
    try {
      const res = await api<{ result: { changed: number; message: string }; report: Report }>('/api/diagnostics/repair', {
        method: 'POST',
        body: { action },
      });
      setReport(res.report);
      setLastResult({ ok: true, message: res.result.message });
      push(res.result.message, 'success');
    } catch (err) {
      setLastResult({ ok: false, message: (err as Error).message });
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Self-diagnosis"
        title="System health"
        description="ROYALWEB inspects its own database, queue, credentials, worker and environment, then shows you the escape route for anything broken."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void load()} loading={loading} icon={<RefreshCw size={14} />}>
              Run self-check
            </Button>
            <Button variant="gold" loading={busy === 'run-tick'} onClick={() => void repair('run-tick')} icon={<Play size={14} />}>
              Run worker tick
            </Button>
          </div>
        }
      />

      {!report ? (
        <div className="py-16">
          <Spinner label="Inspecting the installation…" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-ink-500">Health score</div>
                <Stethoscope size={16} className="text-gold-400" />
              </div>
              <div className="mt-2 flex items-end gap-2">
                <span
                  className={cn(
                    'font-display text-[44px] leading-none',
                    report.health >= 90 ? 'text-ok' : report.health >= 60 ? 'text-warn' : 'text-danger'
                  )}
                >
                  {report.health}
                </span>
                <span className="pb-1 text-[12px] text-ink-500">/ 100</span>
              </div>
              <div className="mt-3">
                <Badge tone={report.status === 'healthy' ? 'green' : report.status === 'degraded' ? 'amber' : 'red'} dot>
                  {report.status}
                </Badge>
              </div>
              <div className="mt-4 space-y-1.5 text-[11px] text-ink-500">
                <div className="flex justify-between">
                  <span>Last heartbeat</span>
                  <span className="text-ink-300">
                    {report.worker.lastHeartbeatAt ? `${report.worker.secondsAgo}s ago` : 'never'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Expected interval</span>
                  <span className="text-ink-300">{report.worker.expectedIntervalSeconds}s</span>
                </div>
                <div className="flex justify-between">
                  <span>Checked</span>
                  <span className="text-ink-300">{relativeTime(report.generatedAt)}</span>
                </div>
              </div>
              {report.worker.stalled ? (
                <div className="mt-3">
                  <Notice tone="amber">
                    No recent tick. Scheduled jobs will not run until the worker or cron is active.
                  </Notice>
                </div>
              ) : null}
            </Card>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Campaigns', report.counts.campaigns],
                  ['Pending jobs', report.counts.pendingJobs],
                  ['Failed jobs', report.counts.failedJobs],
                  ['Connected', report.counts.connectedAccounts],
                ].map(([label, value]) => (
                  <Card key={String(label)} className="p-3.5">
                    <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
                    <div className="mt-1 font-display text-[22px] text-ink-100">{String(value)}</div>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader
                  title="Checks"
                  subtitle="Live probes, not cached status"
                  icon={<Activity size={16} />}
                  action={<span className="text-[10.5px] text-ink-500">{report.checks.length} checks</span>}
                />
                <div className="grid gap-px bg-white/[0.04] sm:grid-cols-2">
                  {report.checks.map((check) => (
                    <div key={check.id} className="bg-obsidian-900/80 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            check.status === 'ok'
                              ? 'bg-ok'
                              : check.status === 'warn'
                                ? 'bg-warn'
                                : check.status === 'fail'
                                  ? 'bg-danger'
                                  : 'bg-info'
                          )}
                        />
                        <span className="text-[12px] font-medium text-ink-200">{check.title}</span>
                        {check.metric ? (
                          <span className="ml-auto text-[10px] text-ink-500">{check.metric}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 pl-3.5 text-[10.5px] leading-relaxed text-ink-500">{check.detail}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          {lastResult ? (
            <div className="mt-4">
              <Notice tone={lastResult.ok ? 'green' : 'red'}>{lastResult.message}</Notice>
            </div>
          ) : null}

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-medium uppercase tracking-wider text-ink-400">
                Problems & how to escape them
              </h2>
              <span className="text-[10.5px] text-ink-500">
                {report.issues.length === 0 ? 'nothing to fix' : `${report.issues.length} issue(s)`}
              </span>
            </div>

            {report.issues.length === 0 ? (
              <Card className="p-6">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={20} className="mt-0.5 text-ok" />
                  <div>
                    <div className="text-[13px] font-medium text-ink-100">Everything ROYALWEB can check is healthy</div>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
                      Database integrity, encryption, worker heartbeat, queue, connections, disk and sessions all pass.
                      Platform-level API errors can still occur — they appear in Failed Posts with the platform&apos;s own
                      message and a recovery guide.
                    </p>
                  </div>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {report.issues.map((issue) => {
                  const guide = guideFor(issue.code);
                  return (
                    <Card key={issue.id} className="p-0">
                      <div className="flex flex-wrap items-start gap-2 border-b border-white/[0.06] px-5 py-3.5">
                        <Badge tone={SEVERITY_TONE[issue.severity]} dot>
                          {issue.severity}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-ink-100">{issue.title}</div>
                          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-400">{issue.meaning}</p>
                        </div>
                        <button
                          onClick={() => setOpenGuide(openGuide === issue.id ? null : issue.id)}
                          className="inline-flex items-center gap-1 text-[10.5px] text-gold-300 hover:text-gold-200"
                        >
                          <CircleHelp size={12} /> {openGuide === issue.id ? 'Hide guide' : 'Why & how'}
                        </button>
                      </div>

                      {openGuide === issue.id ? (
                        <div className="grid gap-4 border-b border-white/[0.06] px-5 py-4 sm:grid-cols-2">
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-ink-500">Why this happens</div>
                            <ul className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-ink-400">
                              {(issue.why.length ? issue.why : guide.why).map((w) => (
                                <li key={w}>• {w}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-ink-500">Escape route</div>
                            <ol className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-ink-300">
                              {(issue.steps.length ? issue.steps : guide.steps).map((s, i) => (
                                <li key={s} className="flex gap-1.5">
                                  <span className="text-gold-400">{i + 1}.</span>
                                  <span>{s}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                          <div className="sm:col-span-2">
                            <div className="text-[10px] uppercase tracking-wider text-danger/80">Do not</div>
                            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-400">{guide.avoid}</p>
                          </div>
                        </div>
                      ) : null}

                      {issue.subjects?.length ? (
                        <div className="border-b border-white/[0.06] px-5 py-2.5">
                          <div className="space-y-0.5">
                            {issue.subjects.slice(0, 6).map((subject) => (
                              <div key={subject} className="truncate text-[10.5px] text-ink-500">
                                {subject}
                              </div>
                            ))}
                            {issue.subjects.length > 6 ? (
                              <div className="text-[10px] text-ink-600">+{issue.subjects.length - 6} more</div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
                        {issue.fix ? (
                          <Button
                            size="sm"
                            variant="gold"
                            loading={busy === issue.fix.action}
                            onClick={() => setConfirming(issue.fix!)}
                            icon={<Wrench size={12} />}
                          >
                            {issue.fix.label}
                          </Button>
                        ) : null}
                        {issue.actions.map((action) =>
                          action.href ? (
                            <Link
                              key={`${issue.id}-${action.label}`}
                              href={action.href}
                              className="inline-flex items-center gap-1 rounded-xl border border-white/[0.09] px-2.5 py-1.5 text-[11.5px] text-ink-200 hover:bg-white/[0.05]"
                            >
                              {action.label} <ArrowUpRight size={11} />
                            </Link>
                          ) : action.repair ? (
                            <Button
                              key={`${issue.id}-${action.label}`}
                              size="sm"
                              variant="secondary"
                              loading={busy === action.repair}
                              onClick={() => void repair(action.repair!)}
                            >
                              {action.label}
                            </Button>
                          ) : null
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          <Card className="mt-5">
            <CardHeader
              title="Common traps and their escape hatches"
              subtitle="The failures operators hit most often, and what actually resolves them"
              icon={<ShieldAlert size={16} />}
              action={
                <Link href="/dashboard/assistant" className="text-[11px] text-gold-300 hover:text-gold-200">
                  Ask the assistant
                </Link>
              }
            />
            <div className="grid gap-px bg-white/[0.04] sm:grid-cols-2">
              {TRAPS.map(({ code, trap }) => {
                const guide = ERROR_GUIDES[code] ?? guideFor(code);
                return (
                  <div key={code} className="bg-obsidian-900/80 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <CircleAlert
                        size={12}
                        className={guide.severity === 'error' ? 'text-danger' : guide.severity === 'warning' ? 'text-warn' : 'text-info'}
                      />
                      <span className="text-[11.5px] font-medium text-ink-200">{trap}</span>
                    </div>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-ink-500">{guide.steps[0]}</p>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-white/[0.06] px-5 py-2.5 text-[10.5px] text-ink-500">
              Full playbook: <span className="text-ink-300">docs/TROUBLESHOOTING.md</span> · nothing here bypasses
              platform rules, CAPTCHAs, paid tiers or approvals.
            </div>
          </Card>
        </>
      )}

      <Modal
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title="Confirm recovery action"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="gold"
              loading={Boolean(confirming && busy === confirming.action)}
              onClick={() => confirming && void repair(confirming.action)}
            >
              {confirming?.label ?? 'Run'}
            </Button>
          </div>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-300">{confirming?.confirm}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
          This action is recorded in the audit log. It never creates new content and never marks anything as
          published.
        </p>
      </Modal>
    </div>
  );
}
