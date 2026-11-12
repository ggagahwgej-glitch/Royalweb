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
  } catch (err) {
    console.error('[instrumentation] startup failed', err);
  }
}
