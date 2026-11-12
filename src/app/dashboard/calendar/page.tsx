import { getSession } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { CalendarView } from '@/components/CalendarView';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const session = await getSession();
  if (!session) return null;
  const settings = getSettings(session.user.id);
  return <CalendarView timezone={settings.defaultTimezone} />;
}
