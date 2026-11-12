import { z } from 'zod';
import { handler, parseBody, audit, jsonOk, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { BackupError, importBackup } from '@/lib/backup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  file: z.string().min(1, 'Choose a backup file').max(4_000_000, 'Backup files are smaller than 4 MB'),
  passphrase: z.string().min(1, 'The passphrase is required').max(200),
  mode: z.enum(['merge', 'replace']).default('merge'),
  /** Replace mode wipes this operator's connected accounts, so it needs consent. */
  confirmReplace: z.boolean().default(false),
});

export const POST = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Only an administrator can import credentials', 'admin_only');
  enforceRateLimit(`backup-import:${auth.user.id}`, 10, 3600);

  const body = await parseBody(req, schema);
  const mode: 'merge' | 'replace' = body.mode ?? 'merge';
  const confirmReplace = body.confirmReplace ?? false;
  if (mode === 'replace' && !confirmReplace) {
    throw new ApiError(
      400,
      'Replace mode deletes the connected accounts in this installation first. Confirm to continue.',
      'confirm_required'
    );
  }

  let report;
  try {
    report = importBackup({
      text: body.file,
      passphrase: body.passphrase,
      mode,
      userId: auth.user.id,
    });
  } catch (err) {
    if (err instanceof BackupError) {
      await audit('backup.import_rejected', 'backup', err.code, auth.user.id, { mode });
      throw new ApiError(400, err.message, err.code);
    }
    throw err;
  }

  await audit('backup.imported', 'backup', report.backupCreatedAt ?? 'unknown', auth.user.id, {
    mode: report.mode,
    secrets: report.secrets.keys,
    accounts: report.accounts.created + report.accounts.updated,
    platforms: report.accounts.platformIds,
    suppressions: report.suppressions.added,
    skipped: report.accounts.skipped.length,
  });

  return jsonOk({ report });
});
