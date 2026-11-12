import { redirect } from 'next/navigation';
import { getSession, countUsers } from '@/lib/auth';
import { ensureBootstrap } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export default async function Home() {
  ensureBootstrap();
  const session = await getSession();
  if (session) redirect('/dashboard');
  redirect(countUsers() === 0 ? '/login?setup=1' : '/login');
}
