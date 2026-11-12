import { z } from 'zod';
import { handler, jsonOk, parseBody, audit } from '@/lib/api';
import { buildDiagnostics, runRepair, type RepairAction } from '@/lib/diagnostics';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  action: z.enum([
    'run-tick',
    'recover-stuck',
    'requeue-overdue',
    'requeue-failed',
    'requeue-expired',
    'resume-publishing',
    'revoke-sessions',
    'reseed-platforms',
    'finalise-campaigns',
  ]),
});

/**
 * Explicit recovery actions. They never publish anything by themselves except
 * `run-tick`, which only drains jobs that are already approved, scheduled and
 * due — exactly what the background worker would have done.
 */
export const POST = handler(async (req, _ctx, auth) => {
  enforceRateLimit(`repair:${auth.user.id}`, 30, 300);
  const { action } = await parseBody(req, schema);
  const result = await runRepair(action as RepairAction, auth.user.id);
  await audit('diagnostics.repair', 'system', action, auth.user.id, { changed: result.changed });
  const report = await buildDiagnostics(auth.user.id);
  return jsonOk({ result, report });
});
