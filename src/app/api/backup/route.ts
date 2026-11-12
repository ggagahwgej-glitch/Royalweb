import { handler, jsonOk } from '@/lib/api';
import { backupStatus } from '@/lib/backup';
import { publicEnvPlan, lastSeedRuns } from '@/lib/env-seed';

export const dynamic = 'force-dynamic';

/**
 * Everything the Settings → Backup & onboarding screen needs, and nothing that
 * could leak a secret: counts, platform ids and masked hints only.
 */
export const GET = handler(async (_req, _ctx, auth) => {
  return jsonOk({
    ...backupStatus(auth.user.id),
    env: {
      ...publicEnvPlan(),
      runs: lastSeedRuns(3),
      jsonVar: 'ROYALWEB_CREDENTIALS',
      seedingDisabled: process.env.ROYALWEB_DISABLE_ENV_SEED === '1',
    },
    encryption: {
      atRest: 'AES-256-GCM (server master key)',
      backup: 'scrypt (N=32768) → AES-256-GCM, passphrase-derived key, header bound as AAD',
    },
  });
});
