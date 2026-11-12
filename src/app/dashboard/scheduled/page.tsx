import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { JobsView } from '@/components/JobsView';

export const dynamic = 'force-dynamic';

export default async function ScheduledPage() {
  const session = await getSession();
  if (!session) return null;
  const settings = getSettings(session.user.id);
  return (
    <JobsView
      filter="scheduled"
      title="Scheduled posts"
      description="Queued jobs waiting for their publishing time. Jobs persist across restarts, and retries use exponential backoff."
      timezone={settings.defaultTimezone}
      actions={
        <Link
          href="/dashboard/new"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 px-3.5 py-2 text-[12.5px] font-medium text-obsidian-950"
        >
          New campaign
        </Link>
      }
    />
  );
}
