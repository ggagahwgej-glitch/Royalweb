/**
 * Next.js instrumentation hook: starts the publishing worker once per process
 * (server-side only). The same work can be triggered through /api/worker/tick
 * when deploying to a serverless platform.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { ensureBootstrap } = await import('./lib/bootstrap');
    ensureBootstrap();
    const { startWorker } = await import('./lib/publishing/worker');
    startWorker();
    // A supervisor that does not depend on the worker loop: it alerts when the
    // worker dies, runs scheduled snapshots, polls feeds and recycles campaigns.
    const { startMonitor } = await import('./lib/monitor');
    startMonitor();
  } catch (err) {
    console.error('[instrumentation] startup failed', err);
  }
}
