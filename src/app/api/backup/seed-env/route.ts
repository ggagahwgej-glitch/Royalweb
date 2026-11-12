import { z } from 'zod';
import { handler, parseBody, audit, jsonOk, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { publicEnvPlan, runEnvSeed, lastSeedRuns } from '@/lib/env-seed';

export const dynamic = 'force-dynamic';

const schema = z.object({
  /** Without this, a POST only reports what it *would* do. */
  apply: z.boolean().default(false),
});

/**
 * Re-run the .env.local pre-fill on demand (first run does it automatically).
 * A dry run is the default so opening the screen never writes anything.
 */
export const POST = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Only an administrator can pre-fill credentials', 'admin_only');
  enforceRateLimit(`env-seed:${auth.user.id}`, 20, 600);

  const { apply } = await parseBody(req, schema);
  if (!apply) {
    const plan = publicEnvPlan();
    return jsonOk({
      applied: false,
      plan,
      message: plan.detected
        ? `${plan.secrets.length} secret(s) and ${plan.readyCount} account(s) are available in .env.local.`
        : 'No ROYALWEB_* or platform credential variables were found in the environment.',
    });
  }

  const report = runEnvSeed(auth.user.id, 'manual');
  await audit('env.seeded', 'system', 'manual', auth.user.id, {
    trigger: 'manual',
    secrets: report.secrets,
    accounts: report.accounts.map((a) => a.platformId),
    skipped: report.skipped.length,
  });

  return jsonOk({ applied: true, report, runs: lastSeedRuns(3) });
});
