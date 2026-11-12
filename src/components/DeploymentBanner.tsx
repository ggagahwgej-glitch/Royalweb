import { CloudOff, Timer } from 'lucide-react';
import { runtimeReport } from '@/lib/runtime';

/**
 * Server-rendered notice shown when the deployment cannot hold data on disk or
 * has no in-process worker. It is deliberately explicit: losing the database
 * when an instance recycles must never come as a surprise.
 */
export function DeploymentBanner() {
  const runtime = runtimeReport();
  const ephemeral = runtime.storage === 'ephemeral';
  if (!ephemeral && runtime.worker === 'in-process') return null;

  return (
    <div className="mb-4 space-y-2">
      {ephemeral ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/[0.07] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-warn">
          <CloudOff size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">Ephemeral storage ({runtime.platform})</span> — the database, posters and
            snapshots live in <span className="font-mono">{runtime.dataDir}</span> and reset when this instance recycles.
            Everything works for a demo, but real campaigns need a persistent disk: deploy the Docker image on a host
            with a volume, or set <span className="font-mono">ROYALWEB_DATA_DIR</span> to durable storage. See{' '}
            <span className="font-mono">docs/DEPLOY.md</span>.
          </div>
        </div>
      ) : null}
      {runtime.worker === 'cron' ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-ink-300">
          <Timer size={14} className="mt-0.5 shrink-0 text-gold-400" />
          <div>
            <span className="font-medium">Scheduled publishing runs from cron</span> on this host —{' '}
            <span className="font-mono">/api/worker/tick</span> and <span className="font-mono">/api/alerts/check</span>{' '}
            every few minutes. Keep <span className="font-mono">CRON_SECRET</span> set, otherwise those calls are
            refused.
          </div>
        </div>
      ) : null}
    </div>
  );
}
