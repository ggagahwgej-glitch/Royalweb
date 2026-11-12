import { getSession } from '@/lib/auth';
import { SettingsView } from '@/components/SettingsView';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) return null;
  return <SettingsView />;
}
