import { getSession } from '@/lib/auth';
import { EmailCenter } from '@/components/EmailCenter';

export const dynamic = 'force-dynamic';

export default async function EmailPage() {
  const session = await getSession();
  if (!session) return null;
  return <EmailCenter />;
}
