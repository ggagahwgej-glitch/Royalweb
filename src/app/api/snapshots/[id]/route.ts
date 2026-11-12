import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { handler, ApiError, audit } from '@/lib/api';
import { snapshotFile } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';

/** Download the encrypted snapshot file itself — never a decrypted copy. */
export const GET = handler(async (_req, ctx, auth) => {
  const { id } = await ctx.params;
  const file = snapshotFile(id);
  if (!file) throw new ApiError(404, 'Snapshot file not found on disk', 'not_found');
  await audit('snapshot.downloaded', 'system', id, auth.user.id);
  const buffer = fs.readFileSync(file.path);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});
