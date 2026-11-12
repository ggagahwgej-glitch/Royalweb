import { getSession } from '@/lib/auth';
import { StudioView } from '@/components/StudioView';

export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  const session = await getSession();
  if (!session) return null;
  return <StudioView />;
}
