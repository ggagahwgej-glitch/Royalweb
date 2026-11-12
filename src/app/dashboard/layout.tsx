import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { ensureBootstrap } from '@/lib/bootstrap';
import { getSettings } from '@/lib/settings';
import { Sidebar, PausedBanner } from '@/components/Sidebar';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  ensureBootstrap();
  const session = await getSession();
  if (!session) redirect('/login');
  const settings = getSettings(session.user.id);

  return (
    <div className="min-h-dvh lg:pl-[264px]">
      <Sidebar
        user={{ name: session.user.name, email: session.user.email }}
        businessName={settings.businessName}
        paused={settings.globalPause}
      />
      <main className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <PausedBanner paused={settings.globalPause} />
        {children}
      </main>
    </div>
  );
}
