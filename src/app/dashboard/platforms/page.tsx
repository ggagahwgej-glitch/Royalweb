import { getSession } from '@/lib/auth';
import { PlatformsView } from '@/components/PlatformsView';

export const dynamic = 'force-dynamic';

export default async function PlatformsPage() {
  const session = await getSession();
  if (!session) return null;
  return <PlatformsView />;
}
