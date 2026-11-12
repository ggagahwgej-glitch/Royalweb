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

    // Serverless functions are created and frozen per request: a setInterval
    // there would either never fire or fire unpredictably. On those hosts the
    // same work is triggered by a cron request to /api/worker/tick and
    // /api/alerts/check.
    const { isServerless, runtimeReport } = await import('./lib/runtime');
    if (isServerless()) {
      const report = runtimeReport();
      console.log(
        `[runtime] serverless (${report.platform}) · storage=${report.storage} · worker=cron · data=${report.dataDir}`
      );
      for (const warning of report.warnings) console.warn(`[runtime] ${warning}`);
      return;
    }

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
