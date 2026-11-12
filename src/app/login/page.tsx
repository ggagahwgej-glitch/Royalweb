import { redirect } from 'next/navigation';
import { getSession, countUsers } from '@/lib/auth';
import { ensureBootstrap } from '@/lib/bootstrap';
import { LoginForm } from '@/components/LoginForm';
import { BrandMark } from '@/components/BrandMark';
import { StartupFailure } from '@/components/StartupFailure';
import { ShieldCheck, Sparkles, Layers } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  let signedIn = false;
  let needsSetup = false;
  try {
    ensureBootstrap();
    signedIn = Boolean(await getSession());
    needsSetup = countUsers() === 0;
  } catch (err) {
    // Render the real cause (data directory, Node version, key) rather than
    // letting the request die as an opaque server-side exception.
    console.error('[login] startup failed:', err);
    return <StartupFailure error={err} where="login" />;
  }
  if (signedIn) redirect('/dashboard');

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.06] p-10 lg:flex">
        <div className="pointer-events-none absolute -left-32 top-1/4 h-[420px] w-[420px] rounded-full bg-gold-500/[0.07] blur-3xl" />
        <BrandMark />
        <div className="relative max-w-lg">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-gold-500/25 bg-gold-500/[0.06] px-3 py-1 text-[11px] font-medium tracking-wide text-gold-200">
            <Sparkles size={12} /> 25 platforms · one upload
          </div>
          <h1 className="font-display text-[44px] leading-[1.08] tracking-tight text-ink-100">
            Publish once.
            <br />
            <span className="gold-text">Reach everywhere.</span>
          </h1>
          <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-ink-400">
            Upload a poster, let the AI prepare platform-native content, then publish through official APIs —
            and get a ready-to-post package for the platforms that don&apos;t allow automation.
          </p>
          <div className="mt-8 grid gap-3 text-[12.5px] text-ink-300">
            <div className="flex items-center gap-2.5"><Layers size={15} className="text-gold-400" /> 18 real API integrations + 7 assisted platforms</div>
            <div className="flex items-center gap-2.5"><ShieldCheck size={15} className="text-gold-400" /> Encrypted credentials, audit trail, no fake results</div>
          </div>
        </div>
        <div className="text-[11px] text-ink-500">ROYALWEB · Website Design &amp; Development</div>
      </div>

      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mb-8 lg:hidden">
          <BrandMark />
        </div>
        <LoginForm needsSetup={needsSetup} />
        <p className="mt-8 max-w-sm text-[11px] leading-relaxed text-ink-500">
          Admin access only. Sessions are HTTP-only, CSRF-protected and expire after 12 hours of inactivity.
          Platform passwords are never requested — only official OAuth tokens or app-specific keys.
        </p>
      </div>
    </div>
  );
}
