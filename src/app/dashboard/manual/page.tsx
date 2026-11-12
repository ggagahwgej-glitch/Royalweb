import { getSession } from '@/lib/auth';
import { ManualCenter } from '@/components/ManualCenter';

export const dynamic = 'force-dynamic';

export default async function ManualPage() {
  const session = await getSession();
  if (!session) return null;
  return <ManualCenter />;
}
