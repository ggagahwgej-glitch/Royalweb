#!/usr/bin/env node
/**
 * Standalone publishing worker.
 *
 * The Next.js server already runs an in-process worker; this script is for
 * deployments where you prefer a separate process (or for platforms that sleep
 * idle functions). It calls the authenticated tick endpoint on a schedule.
 *
 *   ROYALWEB_BASE_URL=http://localhost:3000 ROYALWEB_WORKER_SECRET=… npm run worker
 */
const base = (process.env.ROYALWEB_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const secret = process.env.ROYALWEB_WORKER_SECRET || '';
const interval = Number(process.env.WORKER_INTERVAL_MS || 20000);

if (!secret) {
  console.error('ROYALWEB_WORKER_SECRET is required (must match the server environment).');
  process.exit(1);
}

let running = false;

async function tick() {
  if (running) return;
  running = true;
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/worker/tick`, {
      method: 'POST',
      headers: { 'x-worker-secret': secret, 'x-royalweb-request': '1' },
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[worker] tick failed HTTP ${res.status}: ${body.slice(0, 300)}`);
    } else {
      const data = JSON.parse(body);
      const processed = data?.data?.processed ?? 0;
      if (processed) console.log(`[worker] processed ${processed} job(s) in ${Date.now() - started}ms`);
    }
  } catch (err) {
    console.error(`[worker] tick error: ${err.message}`);
  } finally {
    running = false;
  }
}

console.log(`[worker] polling ${base}/api/worker/tick every ${interval}ms`);
void tick();
setInterval(() => void tick(), interval);
