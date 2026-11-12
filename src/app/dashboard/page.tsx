import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { all, get } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { ADAPTERS } from '@/lib/platforms';
import { jobOut } from '@/lib/serialize';
import { formatInZone, relativeTime } from '@/lib/time';
import {
  ArrowUpRight,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  PenLine,
  PlusCircle,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, PageHeader, ProgressBar, Stat, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const session = await getSession();
  if (!session) return null;
  const userId = session.user.id;
  const settings = getSettings(userId);
  const one = (sql: string, ...params: unknown[]) => Number(get<{ c: number }>(sql, ...params)?.c ?? 0);

  const totals = {
    campaigns: one('SELECT COUNT(*) AS c FROM campaigns WHERE user_id = ?', userId),
    scheduled: one(
      `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id WHERE c.user_id = ? AND j.status = 'scheduled'`,
      userId
    ),
    published: one(
      `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id WHERE c.user_id = ? AND j.status = 'published'`,
      userId
    ),
    failed: one(
      `SELECT COUNT(*) AS c FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id WHERE c.user_id = ? AND j.status IN ('failed','connection_expired')`,
      userId
    ),
    manual: one(
      `SELECT COUNT(*) AS c FROM manual_tasks mt JOIN campaigns c ON c.id = mt.campaign_id WHERE c.user_id = ? AND mt.status = 'pending'`,
      userId
    ),
    connected: one(
      `SELECT COUNT(DISTINCT platform_id) AS c FROM connected_accounts WHERE user_id = ? AND status = 'connected'`,
      userId
    ),
    media: one('SELECT COUNT(*) AS c FROM media_assets WHERE user_id = ? AND deleted_at IS NULL', userId),
  };

  const recentJobs = all(
    `SELECT j.*, c.name AS campaign_name, p.name AS platform_name, p.automation, a.account_name
       FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
       JOIN platforms p ON p.id = j.platform_id
       LEFT JOIN connected_accounts a ON a.id = j.account_id
      WHERE c.user_id = ? ORDER BY j.updated_at DESC LIMIT 6`,
    userId
  ).map(jobOut);

  const upcoming = all(
    `SELECT j.*, c.name AS campaign_name, p.name AS platform_name, p.automation, a.account_name
       FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id
       JOIN platforms p ON p.id = j.platform_id
       LEFT JOIN connected_accounts a ON a.id = j.account_id
      WHERE c.user_id = ? AND j.status = 'scheduled'
      ORDER BY j.scheduled_at ASC LIMIT 5`,
    userId
  ).map(jobOut);

  const accounts = all<{ account_name: string; status: string; last_verified_at: string | null; platform_name: string }>(
    `SELECT a.account_name, a.status, a.last_verified_at, p.name AS platform_name
       FROM connected_accounts a JOIN platforms p ON p.id = a.platform_id
      WHERE a.user_id = ? AND a.status != 'revoked' ORDER BY p.sort_order LIMIT 8`,
    userId
  );

  const lastCampaign = get<{ id: string; name: string; status: string; updated_at: string }>(
    'SELECT id, name, status, updated_at FROM campaigns WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
    userId
  );

  const manualAutomation = ADAPTERS.filter((a) => a.automation === 'manual').length;
  const automatic = ADAPTERS.length - manualAutomation;

  return (
    <div>
      <PageHeader
        eyebrow="Control room"
        title={`Good to see you, ${session.user.name.split(' ')[0]}`}
        description={`${settings.businessName} · ${automatic} API platforms and ${manualAutomation} assisted platforms. Everything here is driven by real publishing records — no simulated results.`}
        actions={
          <>
            <Link href="/dashboard/new">
              <span className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 px-4 py-2.5 text-[13.5px] font-medium text-obsidian-950 shadow-gold hover:from-gold-200 hover:to-gold-400">
                <PlusCircle size={15} /> New campaign
              </span>
            </Link>
            <Link href="/dashboard/assistant">
              <span className="inline-flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.045] px-4 py-2.5 text-[13.5px] text-ink-100 hover:bg-white/[0.08]">
                <Sparkles size={15} className="text-gold-400" /> Ask AI
              </span>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Campaigns" value={totals.campaigns} hint={`${totals.media} media files`} icon={<Send size={15} />} />
        <Stat
          label="Scheduled"
          value={totals.scheduled}
          tone={totals.scheduled ? 'gold' : 'neutral'}
          hint="Queued jobs"
          icon={<CalendarClock size={15} />}
        />
        <Stat label="Published" value={totals.published} tone="green" hint="Confirmed by platforms" icon={<CircleCheck size={15} />} />
        <Stat label="Failed" value={totals.failed} tone={totals.failed ? 'red' : 'neutral'} hint="Needs attention" icon={<CircleAlert size={15} />} />
        <Stat label="Manual queue" value={totals.manual} tone={totals.manual ? 'purple' : 'neutral'} hint="Ready-to-post packages" icon={<PenLine size={15} />} />
        <Stat
          label="Connected"
          value={`${totals.connected}/25`}
          tone="gold"
          hint="Platforms with accounts"
          icon={<Users size={15} />}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Publishing activity"
            subtitle="Every row is a real job record from the database."
            icon={<Send size={16} />}
            action={
              <Link href="/dashboard/published" className="text-[12px] text-gold-300 hover:text-gold-200">
                View all
              </Link>
            }
          />
          {recentJobs.length === 0 ? (
            <EmptyState
              icon={<Send size={22} />}
              title="No publishing activity yet"
              description="Create a campaign, approve the generated content and schedule it. Jobs and their exact platform responses will appear here."
              action={
                <Link href="/dashboard/new">
                  <span className="inline-flex items-center gap-2 rounded-xl border border-gold-500/40 px-4 py-2 text-[12.5px] text-gold-200 hover:bg-gold-500/10">
                    Create your first campaign
                  </span>
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {recentJobs.map((job) => (
                <div key={job.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-ink-100">{job.platformName}</span>
                      <StatusBadge status={job.status} />
                      {job.errorCode === 'auth_expired' ? <Badge tone="red">CONNECTION EXPIRED</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11.5px] text-ink-400">
                      {job.campaignName} · {job.error ? job.error.slice(0, 120) : job.publishedUrl || 'Awaiting schedule'}
                    </div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="text-[11px] text-ink-500">{relativeTime(job.updatedAt)}</div>
                    {job.publishedUrl ? (
                      <a
                        href={job.publishedUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-[11px] text-gold-300 hover:text-gold-200"
                      >
                        Open <ArrowUpRight size={10} />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Up next" subtitle="Scheduled and retrying jobs" icon={<CalendarClock size={16} />} />
            {upcoming.length === 0 ? (
              <div className="px-5 py-6 text-[12.5px] text-ink-400">Nothing scheduled. Your queue is clear.</div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {upcoming.map((job) => (
                  <div key={job.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-medium text-ink-100">{job.platformName}</span>
                      <span className="text-[11px] text-gold-300">
                        {formatInZone(job.scheduledAt, settings.defaultTimezone)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-500">{job.campaignName}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Account health"
              subtitle={`${totals.connected} platforms connected`}
              icon={<Users size={16} />}
              action={
                <Link href="/dashboard/accounts" className="text-[12px] text-gold-300 hover:text-gold-200">
                  Manage
                </Link>
              }
            />
            {accounts.length === 0 ? (
              <div className="px-5 py-5">
                <p className="text-[12.5px] leading-relaxed text-ink-400">
                  No accounts connected yet. Connect Telegram, WordPress or LinkedIn to start automatic publishing.
                </p>
                <Link href="/dashboard/accounts" className="mt-3 inline-block text-[12px] text-gold-300 hover:text-gold-200">
                  Connect an account →
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {accounts.map((account) => (
                  <div key={`${account.platform_name}-${account.account_name}`} className="flex items-center gap-2 px-5 py-2.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        account.status === 'connected' ? 'bg-ok' : 'bg-danger'
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-200">
                      {account.platform_name}
                      <span className="text-ink-500"> · {account.account_name}</span>
                    </span>
                    <span className="text-[10.5px] text-ink-500">{relativeTime(account.last_verified_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Continue where you left off"
            subtitle={lastCampaign ? 'Your most recently updated campaign' : 'Start with one poster'}
            icon={<Sparkles size={16} />}
          />
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            {lastCampaign ? (
              <>
                <div>
                  <div className="text-[13.5px] font-medium text-ink-100">{lastCampaign.name}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusBadge status={lastCampaign.status} />
                    <span className="text-[11px] text-ink-500">updated {relativeTime(lastCampaign.updated_at)}</span>
                  </div>
                </div>
                <Link
                  href={`/dashboard/campaigns/${lastCampaign.id}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.045] px-4 py-2.5 text-[12.5px] text-ink-100 hover:bg-white/[0.08]"
                >
                  Open campaign <ArrowUpRight size={14} />
                </Link>
              </>
            ) : (
              <>
                <p className="max-w-md text-[12.5px] leading-relaxed text-ink-400">
                  Upload one poster and ROYALWEB prepares platform-native captions, titles, hashtags and sized
                  images for all 25 platforms.
                </p>
                <Link
                  href="/dashboard/new"
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 px-4 py-2.5 text-[12.5px] font-medium text-obsidian-950"
                >
                  <PlusCircle size={14} /> Create campaign
                </Link>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Publishing health" subtitle="Last 30 days" icon={<CircleCheck size={16} />} />
          <div className="space-y-3 px-5 py-4">
            <div>
              <div className="mb-1 flex justify-between text-[11.5px]">
                <span className="text-ink-300">Delivered</span>
                <span className="text-ink-400">
                  {totals.published} / {totals.published + totals.failed || 0}
                </span>
              </div>
              <ProgressBar value={totals.published} total={totals.published + totals.failed} tone="green" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11.5px]">
                <span className="text-ink-300">Platforms connected</span>
                <span className="text-ink-400">{totals.connected} / 25</span>
              </div>
              <ProgressBar value={totals.connected} total={25} tone="gold" />
            </div>
            <p className="pt-1 text-[11px] leading-relaxed text-ink-500">
              Engagement metrics (impressions, likes, reach) are not returned by these platform APIs, so ROYALWEB
              never displays invented numbers.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
