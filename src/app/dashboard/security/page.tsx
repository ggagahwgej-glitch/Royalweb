import { getSession } from '@/lib/auth';
import { SecurityView } from '@/components/SecurityView';

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const session = await getSession();
  if (!session) return null;
  return <SecurityView />;
}
