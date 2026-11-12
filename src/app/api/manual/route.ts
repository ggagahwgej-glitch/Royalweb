import { handler, jsonOk } from '@/lib/api';
import { all } from '@/lib/db';
import { manualOut, contentOut, mediaOut } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export const GET = handler(async (req, _ctx, auth) => {
  const status = new URL(req.url).searchParams.get('status');
  const rows = all(
    `SELECT mt.*, c.name AS campaign_name, p.name AS platform_name FROM manual_tasks mt
       JOIN campaigns c ON c.id = mt.campaign_id
       JOIN platforms p ON p.id = mt.platform_id
      WHERE c.user_id = ? ${status && status !== 'all' ? 'AND mt.status = ?' : ''}
      ORDER BY (mt.status = 'pending') DESC, mt.created_at DESC LIMIT 200`,
    ...(status && status !== 'all' ? [auth.user.id, status] : [auth.user.id])
  );

  const tasks = rows.map((row) => {
    const content = all(
      `SELECT gc.*, p.name AS platform_name FROM generated_contents gc
         JOIN platforms p ON p.id = gc.platform_id WHERE gc.id = ?`,
      row.content_id ?? ''
    )[0];
    const media = all(
      `SELECT * FROM media_assets WHERE campaign_id = ? AND deleted_at IS NULL ORDER BY created_at`,
      row.campaign_id
    );
    return {
      ...manualOut(row),
      content: content ? contentOut(content) : null,
      media: media.map(mediaOut),
    };
  });

  return jsonOk({ tasks });
});
