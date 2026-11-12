import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { runtimeReport } from '@/lib/runtime';

/**
 * Rendered when the app cannot reach its own storage at request time.
 *
 * Previously such a failure escaped the render and Next.js answered with the
 * generic "Application error: a server-side exception has occurred" page — a
 * digest number and nothing else. This screen states what failed, where the data
 * directory points, which Node version is running, and how to confirm it with
 * /api/health?deep=1. The error is still logged in full on the server; nothing is
 * swallowed.
 */
export function StartupFailure({ error, where }: { error: unknown; where: string }) {
  const message = error instanceof Error ? error.message : String(error);
  const digest = (error as { digest?: string } | null)?.digest;
  let runtime: ReturnType<typeof runtimeReport> | null = null;
  try {
    runtime = runtimeReport();
  } catch {
    runtime = null;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex items-center gap-3">
        <span className="rounded-full border border-red-500/30 bg-red-500/10 p-2 text-red-300">
          <AlertTriangle size={18} />
        </span>
        <div>
          <h1 className="font-display text-2xl text-ink-100">ROYALWEB could not start</h1>
          <p className="text-[12.5px] text-ink-400">
            The application is running, but its storage layer failed while loading this page.
          </p>
        </div>
      </div>

      <div className="card p-4">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">Error</p>
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-red-200">{message}</pre>
        <p className="mt-2 font-mono text-[11px] text-ink-500">
          page: {where}
          {digest ? ` · digest: ${digest}` : ''}
        </p>
      </div>

      <div className="card p-4 text-[12.5px] text-ink-300">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-500">Runtime</p>
        <ul className="space-y-1 font-mono text-[12px] text-ink-400">
          <li>node · {runtime?.node ?? 'unknown'}</li>
          <li>platform · {runtime?.platform ?? 'unknown'}</li>
          <li>
            data dir · {runtime?.dataDir ?? 'unknown'} ({runtime?.storage ?? 'unknown'}
            {runtime?.dataDirRequested ? `, requested ${runtime.dataDirRequested}` : ''})
          </li>
          {runtime?.dataDirIssue ? <li className="text-amber-300">issue · {runtime.dataDirIssue}</li> : null}
        </ul>
      </div>

      <div className="space-y-2 text-[13px] leading-relaxed text-ink-300">
        <p className="text-ink-200">How to fix it</p>
        <ol className="list-decimal space-y-1 pl-5 text-ink-400">
          <li>
            The data directory must be writable. On a serverless host keep <code>ROYALWEB_DATA_DIR</code> unset (the app
            uses <code>/tmp/royalweb</code>) or point it at a mounted volume.
          </li>
          <li>
            The runtime must be Node.js 22.13 or newer — <code>node:sqlite</code> is only available unflagged from that
            version. On Vercel: Project Settings → General → Node.js Version → 22.x or 24.x (Node 20 was discontinued on 2026-10-01).
          </li>
          <li>
            Set <code>ROYALWEB_ENCRYPTION_KEY</code> (32 bytes, hex or base64) so saved credentials survive a redeploy.
          </li>
        </ol>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/api/health?deep=1" className="inline-flex items-center gap-2 rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-2.5 text-[13.5px] font-medium text-gold-200 transition hover:bg-gold-500/15" prefetch={false}>
          Open diagnostics (/api/health?deep=1)
        </Link>
        <Link href={where === 'login' ? '/' : '/login'} className="inline-flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.045] px-4 py-2.5 text-[13.5px] font-medium text-ink-100 transition hover:border-white/[0.16] hover:bg-white/[0.075]" prefetch={false}>
          <RefreshCw size={13} /> Try again
        </Link>
        <span className="text-[11.5px] text-ink-500">
          Full stack trace is in the server log; see docs/DEPLOY.md → Troubleshooting.
        </span>
      </div>
    </main>
  );
}
