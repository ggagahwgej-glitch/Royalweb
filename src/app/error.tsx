'use client';

/**
 * Route-level error boundary.
 *
 * In production Next.js replaces a server-side exception with a bare
 * "Application error: a server-side exception has occurred" page. This boundary
 * keeps the digest (so the server log entry can be found) but also shows the
 * message Next.js passes to the client and a link to /api/health?deep=1, so an
 * operator can tell a bad token from an unwritable data directory without
 * digging through Vercel's log viewer.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-5 px-6 py-16">
      <div>
        <h1 className="font-display text-2xl text-ink-100">This page failed to load</h1>
        <p className="mt-1 text-[13px] text-ink-400">
          The server raised an exception while rendering. The full stack trace is in the server log.
        </p>
      </div>

      <div className="card p-4">
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-red-200">
          {error.message || 'Unknown server error'}
        </pre>
        {error.digest ? (
          <p className="mt-2 font-mono text-[11px] text-ink-500">digest: {error.digest}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-xl border border-gold-500/40 bg-gold-500/10 px-4 py-2.5 text-[13.5px] font-medium text-gold-200 transition hover:bg-gold-500/15"
        >
          Try again
        </button>
        <a
          href="/api/health?deep=1"
          className="inline-flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.045] px-4 py-2.5 text-[13.5px] font-medium text-ink-100 transition hover:border-white/[0.16] hover:bg-white/[0.075]"
        >
          Diagnostics (/api/health?deep=1)
        </a>
      </div>

      <p className="text-[11.5px] leading-relaxed text-ink-500">
        Serverless checklist: Node 22.13+, a writable data directory (unset <code>ROYALWEB_DATA_DIR</code> or a mounted
        volume), and <code>ROYALWEB_ENCRYPTION_KEY</code> set. See docs/DEPLOY.md → Troubleshooting.
      </p>
    </main>
  );
}
