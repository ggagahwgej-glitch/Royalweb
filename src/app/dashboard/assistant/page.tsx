import { getSession } from '@/lib/auth';
import { AssistantView } from '@/components/AssistantView';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const session = await getSession();
  if (!session) return null;
  return <AssistantView />;
}
