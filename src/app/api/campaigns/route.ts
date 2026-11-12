import { handler, jsonOk, parseBody, ApiError } from '@/lib/api';
import { all, get, newId, nowIso, run, tx } from '@/lib/db';
import { campaignSchema } from '@/lib/validation';
import { campaignOut } from '@/lib/serialize';
import { enforceRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const createSchema = campaignSchema.extend({
  mediaIds: z.array(z.string().uuid()).max(12).optional(),
});

export const GET = handler(async (req, _ctx, auth) => {
  const status = new URL(req.url).searchParams.get('status');
  const rows = all(
    `SELECT c.*,
       (SELECT COUNT(*) FROM media_assets m WHERE m.campaign_id = c.id AND m.deleted_at IS NULL) AS media_count,
       (SELECT COUNT(*) FROM publishing_jobs j WHERE j.campaign_id = c.id) AS job_count,
       (SELECT COUNT(*) FROM publishing_jobs j WHERE j.campaign_id = c.id AND j.status = 'published') AS published_count,
       (SELECT COUNT(*) FROM generated_contents gc WHERE gc.campaign_id = c.id) AS content_count,
       (SELECT COUNT(*) FROM generated_contents gc WHERE gc.campaign_id = c.id AND gc.status = 'approved') AS approved_count
     FROM campaigns c WHERE c.user_id = ? ${status ? 'AND c.status = ?' : ''}
     ORDER BY c.created_at DESC LIMIT 100`,
    ...(status ? [auth.user.id, status] : [auth.user.id])
  );
  return jsonOk({ campaigns: rows.map((r) => campaignOut(r)) });
});

export const POST = handler(async (req, _ctx, auth) => {
  enforceRateLimit(`campaign-create:${auth.user.id}`, 30, 300);
  const body = await parseBody(req, createSchema);
  const id = newId();
  const ts = nowIso();

  tx(() => {
    run(
      `INSERT INTO campaigns (id, user_id, name, business_category, service_name, offer_price, website_url,
        whatsapp_url, contact_info, description, target_audience, language, cta, status, timezone, recurrence,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      id,
      auth.user.id,
      body.name,
      body.businessCategory,
      body.serviceName,
      body.offerPrice,
      body.websiteUrl,
      body.whatsappUrl,
      body.contactInfo,
      body.description,
      body.targetAudience,
      body.language,
      body.cta,
      body.timezone,
      body.recurrence,
      ts,
      ts
    );
    for (const mediaId of body.mediaIds ?? []) {
      const owned = get<{ id: string }>(
        'SELECT id FROM media_assets WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
        mediaId,
        auth.user.id
      );
      if (!owned) continue;
      run('UPDATE media_assets SET campaign_id = ? WHERE id = ?', id, mediaId);
    }
  });

  const row = get<Record<string, unknown>>('SELECT * FROM campaigns WHERE id = ?', id);
  if (!row) throw new ApiError(500, 'Campaign could not be created', 'create_failed');
  return jsonOk({ campaign: campaignOut(row) }, { status: 201 });
});
