import { z } from 'zod';
import { handler, jsonOk, parseBody, ApiError, audit } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getAdapter } from '@/lib/platforms';
import { connectAccount, missingFields } from '@/lib/accounts/connect';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const entrySchema = z.object({
  platformId: z.string().trim().min(1).max(60),
  accountName: z.string().trim().max(160).optional(),
  credentials: z.record(z.string().max(4000)).default({}),
});

const schema = z.object({
  entries: z.array(entrySchema).min(1).max(25),
  /** Optional: mark platforms that were left empty, so the report is explicit. */
  skipEmpty: z.boolean().default(true),
});

/**
 * Save & verify many platforms in one action (the quick-connect paste grid).
 *
 * Every entry goes through the same connectAccount() path as the single-account
 * form: required-field check, a real verification call to the platform, encrypted
 * storage. Partial success is reported honestly — one bad key never hides behind
 * another platform's success.
 */
export const POST = handler(async (req, _ctx, auth) => {
  enforceRateLimit(`account-bulk:${auth.user.id}`, 20, 600);
  const body = await parseBody(req, schema);

  const seen = new Set<string>();
  const results: {
    platformId: string;
    platformName?: string;
    ok: boolean;
    status: 'connected' | 'skipped' | 'invalid' | 'failed';
    accountName?: string | null;
    detail?: string;
    missing?: string[];
  }[] = [];

  for (const entry of body.entries) {
    if (seen.has(entry.platformId)) {
      results.push({ platformId: entry.platformId, ok: false, status: 'invalid', detail: 'Duplicate platform in this request.' });
      continue;
    }
    seen.add(entry.platformId);

    const adapter = getAdapter(entry.platformId);
    if (!adapter) {
      results.push({ platformId: entry.platformId, ok: false, status: 'invalid', detail: 'Unknown platform.' });
      continue;
    }

    const filled = Object.values(entry.credentials ?? {}).some((v) => typeof v === 'string' && v.trim());
    const missing = missingFields(entry.platformId, entry.credentials ?? {});
    if (!filled) {
      results.push({
        platformId: entry.platformId,
        platformName: adapter.name,
        ok: false,
        status: 'skipped',
        detail: missing.length ? `No credentials entered (needs ${missing.join(', ')}).` : 'No credentials entered.',
        missing,
      });
      continue;
    }

    const result = await connectAccount({
      userId: auth.user.id,
      workspaceId: auth.workspaceId,
      platformId: entry.platformId,
      accountName: entry.accountName ?? null,
      credentials: entry.credentials ?? {},
      via: 'bulk',
    });

    results.push({
      platformId: entry.platformId,
      platformName: adapter.name,
      ok: result.ok,
      status: result.ok ? 'connected' : 'failed',
      accountName: result.ok ? result.account?.accountName ?? null : null,
      detail: result.detail,
      missing: result.missing,
    });
  }

  const connected = results.filter((r) => r.status === 'connected').length;
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'invalid').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  await audit('account.bulk_connect', 'connected_account', `${connected}/${results.length}`, auth.user.id, {
    connected,
    failed,
    skipped,
    platforms: results.filter((r) => r.status === 'connected').map((r) => r.platformId),
  });

  return jsonOk({
    summary: { attempted: results.length, connected, failed, skipped },
    results,
  });
});
