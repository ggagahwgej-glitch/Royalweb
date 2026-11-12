import { getSession } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { JobsView } from '@/components/JobsView';

export const dynamic = 'force-dynamic';

export default async function FailedPage() {
  const session = await getSession();
  if (!session) return null;
  const settings = getSettings(session.user.id);
  return (
    <JobsView
      filter="failed"
      title="Failed posts"
      description="Real platform errors — expired tokens, missing permissions, rate limits and rejected content. Retry after fixing the cause; permanent errors are not retried endlessly."
      timezone={settings.defaultTimezone}
    />
  );
}
