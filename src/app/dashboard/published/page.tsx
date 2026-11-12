import { getSession } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { JobsView } from '@/components/JobsView';

export const dynamic = 'force-dynamic';

export default async function PublishedPage() {
  const session = await getSession();
  if (!session) return null;
  const settings = getSettings(session.user.id);
  return (
    <JobsView
      filter="published"
      title="Published posts"
      description="Only posts the platform confirmed with an ID or URL appear here. Each row links to the live post where the platform returns a URL."
      timezone={settings.defaultTimezone}
    />
  );
}
