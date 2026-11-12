import { NextRequest } from 'next/server';
import { assertSameOrigin, audit, jsonError, jsonOk, parseBody, ApiError } from '@/lib/api';
import { countUsers, createAdmin, createSession } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { setupSchema } from '@/lib/validation';
import { ensureBootstrap } from '@/lib/bootstrap';
import { runEnvSeed } from '@/lib/env-seed';

export const dynamic = 'force-dynamic';

/** First-run administrator creation. Disabled once any user exists. */
export async function POST(req: NextRequest) {
  try {
    ensureBootstrap();
    await assertSameOrigin(req);
    enforceRateLimit('setup', 5, 3600);
    if ((await countUsers()) > 0) {
      throw new ApiError(409, 'Setup has already been completed. Sign in instead.', 'already_setup');
    }
    const body = await parseBody(req, setupSchema);
    const user = await createAdmin({ ...body, name: body.name || 'ROYALWEB Admin' });
    await createSession(user.id);
    await audit('admin.created', 'user', user.id, user.id);

    // First-run onboarding: whatever .env.local already defines is stored
    // encrypted now, so the operator does not retype it. Accounts land as
    // `unverified` — configuration is not proof that a platform still accepts
    // the token, and only a real verification call can make it `connected`.
    let seed: unknown = null;
    try {
      const report = runEnvSeed(user.id, 'first_run');
      seed = {
        secrets: report.secrets.length,
        accounts: report.accounts.length,
        skipped: report.skipped.length,
        notes: report.notes,
        accountList: report.accounts.map((a) => `${a.platformName} · ${a.accountName}`),
      };
      if (report.secrets.length || report.accounts.length) {
        await audit('env.seeded', 'system', 'first_run', user.id, {
          trigger: 'first_run',
          secrets: report.secrets.length,
          accounts: report.accounts.length,
          platforms: report.accounts.map((a) => a.platformId),
        });
      }
    } catch (err) {
      console.error('[setup] .env.local pre-fill failed:', err);
      seed = { error: 'Pre-fill from .env.local failed — see the server log. Setup itself succeeded.' };
    }

    return jsonOk({ user, seed });
  } catch (err) {
    return jsonError(err);
  }
}
