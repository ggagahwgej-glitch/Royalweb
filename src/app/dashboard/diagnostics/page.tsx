import { getSession } from '@/lib/auth';
import { DiagnosticsView } from '@/components/DiagnosticsView';

export const dynamic = 'force-dynamic';

export default async function DiagnosticsPage() {
  const session = await getSession();
  if (!session) return null;
  return <DiagnosticsView />;
}
