import { handler, jsonOk } from '@/lib/api';
import { buildDiagnostics } from '@/lib/diagnostics';

export const dynamic = 'force-dynamic';

/** Read-only self-check. Repairs live in /api/diagnostics/repair. */
export const GET = handler(async (_req, _ctx, auth) => {
  const report = await buildDiagnostics(auth.user.id);
  return jsonOk(report);
});
