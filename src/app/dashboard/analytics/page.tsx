import { getSession } from '@/lib/auth';
import { AnalyticsView } from '@/components/AnalyticsView';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session) return null;
  return <AnalyticsView />;
}
