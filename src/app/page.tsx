import { redirect } from 'next/navigation';
import { getSession, countUsers } from '@/lib/auth';
import { ensureBootstrap } from '@/lib/bootstrap';
import { StartupFailure } from '@/components/StartupFailure';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let signedIn = false;
  let needsSetup = false;
  try {
    ensureBootstrap();
    signedIn = Boolean(await getSession());
    needsSetup = countUsers() === 0;
  } catch (err) {
    // A storage/runtime failure must explain itself instead of becoming the
    // generic "Application error: a server-side exception" page.
    console.error('[home] startup failed:', err);
    return <StartupFailure error={err} where="/" />;
  }
  if (signedIn) redirect('/dashboard');
  redirect(needsSetup ? '/login?setup=1' : '/login');
}
