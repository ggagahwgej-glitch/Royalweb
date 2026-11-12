import { getSession } from '@/lib/auth';
import { AccountsView } from '@/components/AccountsView';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const session = await getSession();
  if (!session) return null;
  return <AccountsView />;
}
