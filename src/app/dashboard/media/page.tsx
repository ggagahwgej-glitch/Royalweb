import { getSession } from '@/lib/auth';
import { MediaLibrary } from '@/components/MediaLibrary';

export const dynamic = 'force-dynamic';

export default async function MediaPage() {
  const session = await getSession();
  if (!session) return null;
  return <MediaLibrary />;
}
