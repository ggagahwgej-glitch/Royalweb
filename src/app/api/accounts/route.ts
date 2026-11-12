import { handler, jsonOk, parseBody, ApiError } from '@/lib/api';
import { all } from '@/lib/db';
import { getAdapter } from '@/lib/platforms';
import { accountSchema } from '@/lib/validation';
import { accountOut } from '@/lib/serialize';
import { connectAccount } from '@/lib/accounts/connect';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req, _ctx, auth) => {
  const rows = all(
    `SELECT a.*, p.name AS platform_name, p.automation FROM connected_accounts a
       JOIN platforms p ON p.id = a.platform_id
      WHERE a.user_id = ? AND a.status != 'revoked'
        AND (a.workspace_id = ? OR (a.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))
      ORDER BY p.sort_order, a.created_at`,
    auth.user.id,
    auth.workspaceId,
    auth.workspaceId,
    auth.user.id
  );
  return jsonOk({ accounts: rows.map(accountOut) });
});

export const POST = handler(async (req, _ctx, auth) => {
  enforceRateLimit(`account-connect:${auth.user.id}`, 30, 600);
  const body = await parseBody(req, accountSchema);
  const adapter = getAdapter(body.platformId);
  if (!adapter) throw new ApiError(404, 'Unknown platform', 'unknown_platform');

  const result = await connectAccount({
    userId: auth.user.id,
    workspaceId: auth.workspaceId,
    platformId: body.platformId,
    accountName: body.accountName,
    credentials: body.credentials ?? {},
    via: 'single',
  });

  if (!result.ok) {
    if (result.code === 'missing_credentials') {
      throw new ApiError(400, result.detail ?? 'Missing required credentials', 'missing_credentials', {
        missing: result.missing,
      });
    }
    throw new ApiError(400, result.detail ?? 'The platform rejected these credentials.', 'verification_failed');
  }

  return jsonOk({ account: result.account, verification: result.verification });
});
