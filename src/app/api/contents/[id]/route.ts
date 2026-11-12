import { inWorkspace } from '@/lib/scope';
import { handler, jsonOk, ApiError, parseBody, audit } from '@/lib/api';
import { get, nowIso, run } from '@/lib/db';
import { contentPatchSchema } from '@/lib/validation';
import { contentOut } from '@/lib/serialize';
import { contentFingerprint } from '@/lib/content-hash';

export const dynamic = 'force-dynamic';

function loadOwned(contentId: string, auth: { user: { id: string }; workspaceId: string | null }) {
  return get<Record<string, unknown>>(
    `SELECT gc.*, p.name AS platform_name, p.automation FROM generated_contents gc
       JOIN platforms p ON p.id = gc.platform_id
       JOIN campaigns c ON c.id = gc.campaign_id
      WHERE gc.id = ? AND c.user_id = ?`,
    contentId,
    auth.user.id
  );
}

export const GET = handler(async (_req, ctx, auth) => {
  const { id } = await ctx.params;
  const row = loadOwned(id, auth);
  if (!row || !inWorkspace('generated_contents', id, auth)) throw new ApiError(404, 'Content not found', 'not_found');
  return jsonOk({ content: contentOut(row) });
});

export const PATCH = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const row = loadOwned(id, auth);
  if (!row || !inWorkspace('generated_contents', id, auth)) throw new ApiError(404, 'Content not found', 'not_found');
  const body = await parseBody(req, contentPatchSchema);

  const sets: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, string> = {
    title: 'title',
    caption: 'caption',
    description: 'description',
    cta: 'cta',
    destinationUrl: 'destination_url',
    altText: 'alt_text',
    status: 'status',
  };
  for (const [key, column] of Object.entries(map)) {
    const value = (body as Record<string, unknown>)[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (body.hashtags) {
    sets.push('hashtags_json = ?');
    values.push(JSON.stringify(body.hashtags.map((h) => h.replace(/^#/, ''))));
  }
  if (!sets.length) return jsonOk({ content: contentOut(row) });

  const nextTitle = body.title ?? String(row.title ?? '');
  const nextCaption = body.caption ?? String(row.caption ?? '');
  const nextDescription = body.description ?? String(row.description ?? '');
  const nextHashtags = body.hashtags
    ? body.hashtags.map((h) => h.replace(/^#/, ''))
    : (() => {
        try {
          return JSON.parse(String(row.hashtags_json ?? '[]')) as string[];
        } catch {
          return [];
        }
      })();
  sets.push('content_hash = ?', 'updated_at = ?');
  values.push(
    contentFingerprint({
      platform: String(row.platform_id ?? ''),
      title: nextTitle,
      caption: nextCaption,
      description: nextDescription,
      hashtags: nextHashtags,
    }),
    nowIso(),
    id
  );
  run(`UPDATE generated_contents SET ${sets.join(', ')} WHERE id = ?`, ...values);
  await audit('content.updated', 'generated_content', id, auth.user.id, { status: body.status });
  const updated = loadOwned(id, auth);
  return jsonOk({ content: contentOut(updated!) });
});
