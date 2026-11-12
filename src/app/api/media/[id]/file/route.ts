import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { inWorkspace } from '@/lib/scope';
import { get } from '@/lib/db';
import { readDerivative } from '@/lib/media/storage';
import { absoluteMediaPath } from '@/lib/media/storage';
import fs from 'node:fs';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';

/** Authenticated media file endpoint (original, thumbnail or a platform preset). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const variant = new URL(req.url).searchParams.get('variant') || 'original';

  if (!inWorkspace('media_assets', id, { user: session.user, workspaceId: session.workspaceId ?? null })) {
    return new Response('Not found', { status: 404 });
  }
  const row = get<{ filename: string; mime: string; kind: string }>(
    'SELECT filename, mime, kind FROM media_assets WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    id,
    session.user.id
  );
  if (!row) return new Response('Not found', { status: 404 });

  try {
    if (variant !== 'original' && row.kind === 'image') {
      const cached = readDerivative(id, `view_${variant}`);
      if (cached) {
        return new Response(new Uint8Array(cached), {
          headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=300' },
        });
      }
      const source = fs.readFileSync(absoluteMediaPath(row.filename));
      if (variant === 'thumb') {
        const thumb = await sharp(source).resize(640, 640, { fit: 'inside' }).webp({ quality: 78 }).toBuffer();
        return new Response(new Uint8Array(thumb), {
          headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=600' },
        });
      }
      const derivative = readDerivative(id, variant);
      if (derivative) {
        return new Response(new Uint8Array(derivative), {
          headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=300' },
        });
      }
    }
    const buffer = fs.readFileSync(absoluteMediaPath(row.filename));
    return new Response(new Uint8Array(buffer), {
      headers: {
        'content-type': row.mime || 'application/octet-stream',
        'cache-control': 'private, max-age=60',
        'content-disposition': `inline; filename="${row.filename}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response('File unavailable', { status: 410 });
  }
}
