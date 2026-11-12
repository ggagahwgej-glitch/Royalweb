import { inWorkspace } from '@/lib/scope';
import { handler, jsonOk, parseBody, ApiError, audit } from '@/lib/api';
import { all, get, nowIso, run, tx } from '@/lib/db';
import { campaignPatchSchema } from '@/lib/validation';
import { campaignOut, contentOut, jobOut, manualOut, mediaOut } from '@/lib/serialize';
import { campaignProgress } from '@/lib/publishing/engine';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req, ctx, auth) => {
  const { id } = await ctx.params;
  const campaign = get<Record<string, unknown>>('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', id, auth.user.id);
  if (!campaign || !inWorkspace('campaigns', id, auth)) throw new ApiError(404, 'Campaign not found', 'not_found');
  if (!campaign) throw new ApiError(404, 'Campaign not found', 'not_found');

  const media = all(
    'SELECT * FROM media_assets WHERE campaign_id = ? AND deleted_at IS NULL ORDER BY created_at',
    id
  );
  const contents = all(
    `SELECT gc.*, p.name AS platform_name, p.automation FROM generated_contents gc
       JOIN platforms p ON p.id = gc.platform_id WHERE gc.campaign_id = ? ORDER BY p.sort_order`,
    id
  );
  const jobs = all(
    `SELECT j.*, p.name AS platform_name, p.automation, a.account_name FROM publishing_jobs j
       JOIN platforms p ON p.id = j.platform_id
       LEFT JOIN connected_accounts a ON a.id = j.account_id
      WHERE j.campaign_id = ? ORDER BY j.scheduled_at DESC`,
    id
  );
  const manual = all(
    `SELECT mt.*, p.name AS platform_name FROM manual_tasks mt
       JOIN platforms p ON p.id = mt.platform_id WHERE mt.campaign_id = ? ORDER BY p.sort_order`,
    id
  );
  const logs = all(
    `SELECT * FROM publishing_logs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 60`,
    id
  );
  return jsonOk({
    campaign: campaignOut(campaign),
    media: media.map(mediaOut),
    contents: contents.map(contentOut),
    jobs: jobs.map(jobOut),
    manualTasks: manual.map(manualOut),
    logs,
    progress: campaignProgress(id),
  });
});

export const PATCH = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, campaignPatchSchema);
  const existing = get<{ id: string }>('SELECT id FROM campaigns WHERE id = ? AND user_id = ?', id, auth.user.id);
  if (!existing || !inWorkspace('campaigns', id, auth)) throw new ApiError(404, 'Campaign not found', 'not_found');
  if (!existing) throw new ApiError(404, 'Campaign not found', 'not_found');

  const map: Record<string, string> = {
    name: 'name',
    businessCategory: 'business_category',
    serviceName: 'service_name',
    offerPrice: 'offer_price',
    websiteUrl: 'website_url',
    whatsappUrl: 'whatsapp_url',
    contactInfo: 'contact_info',
    description: 'description',
    targetAudience: 'target_audience',
    language: 'language',
    cta: 'cta',
    timezone: 'timezone',
    recurrence: 'recurrence',
    status: 'status',
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = (body as Record<string, unknown>)[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (!sets.length) return jsonOk({ campaign: campaignOut(get('SELECT * FROM campaigns WHERE id = ?', id)!) });
  sets.push('updated_at = ?');
  values.push(nowIso(), id);
  run(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`, ...values);

  if (body.status === 'cancelled') {
    run(
      `UPDATE publishing_jobs SET status = 'cancelled', error = 'Campaign cancelled by admin',
         updated_at = ? WHERE campaign_id = ? AND status IN ('scheduled','waiting_approval')`,
      nowIso(),
      id
    );
  }
  if (body.status === 'paused') {
    run("UPDATE publishing_jobs SET updated_at = ? WHERE campaign_id = ? AND status = 'scheduled'", nowIso(), id);
  }
  await audit('campaign.updated', 'campaign', id, auth.user.id, { fields: Object.keys(body) });
  return jsonOk({ campaign: campaignOut(get('SELECT * FROM campaigns WHERE id = ?', id)!) });
});

export const DELETE = handler(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const force = new URL(req.url).searchParams.get('force') === '1';
  const campaign = get<{ id: string; status: string }>(
    'SELECT id, status FROM campaigns WHERE id = ? AND user_id = ?',
    id,
    auth.user.id
  );
  if (!campaign) throw new ApiError(404, 'Campaign not found', 'not_found');
  if (['scheduled', 'publishing'].includes(campaign.status) && !force) {
    throw new ApiError(
      409,
      'This campaign is scheduled or publishing. Pause it first, or delete with confirmation.',
      'campaign_active'
    );
  }
  tx(() => {
    run('UPDATE media_assets SET campaign_id = NULL WHERE campaign_id = ?', id);
    run('DELETE FROM campaigns WHERE id = ?', id);
  });
  await audit('campaign.deleted', 'campaign', id, auth.user.id, { forced: force });
  return jsonOk({ deleted: true });
});
