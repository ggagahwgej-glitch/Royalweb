import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, parseBody, audit, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { backupCounts, backupFileName, collectBackup, sealBackup } from '@/lib/backup';

export const dynamic = 'force-dynamic';

const schema = z.object({
  passphrase: z
    .string()
    .min(12, 'Use at least 12 characters — this passphrase is the only key to the file.')
    .max(200),
});

/**
 * Encrypted configuration export.
 *
 * The response body is the sealed document itself (a JSON file). It is the only
 * endpoint in the app that intentionally emits secret material, and it only
 * does so encrypted with a passphrase the operator typed — never with the
 * server's own key, which would make the file useless after a reinstall.
 */
export const POST = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Only an administrator can export credentials', 'admin_only');
  enforceRateLimit(`backup-export:${auth.user.id}`, 10, 3600);

  const { passphrase } = await parseBody(req, schema);

  const payload = collectBackup(auth.user.id, auth.user.email);
  const counts = backupCounts(payload);
  if (counts.secrets === 0 && counts.accounts === 0) {
    throw new ApiError(
      400,
      'There is nothing to export yet — no saved credentials, OAuth tokens or SMTP settings.',
      'nothing_to_export'
    );
  }

  const sealed = sealBackup(payload, passphrase);
  const fileName = backupFileName();

  await audit('backup.exported', 'backup', fileName, auth.user.id, {
    secrets: counts.secrets,
    accounts: counts.accounts,
    suppressions: counts.suppressions,
    platforms: counts.platforms,
    bytes: sealed.length,
    // Key names only: the audit log must never contain a value.
    keys: payload.secrets.map((s) => s.key),
  });

  return new NextResponse(sealed, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'x-royalweb-backup': 'secrets=' + counts.secrets + ';accounts=' + counts.accounts,
    },
  });
});
