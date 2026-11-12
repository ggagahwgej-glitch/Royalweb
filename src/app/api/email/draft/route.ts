import { z } from 'zod';
import { handler, jsonOk, parseBody } from '@/lib/api';
import { get } from '@/lib/db';
import { draftEmail } from '@/lib/email/draft';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const schema = z.object({
  template: z.enum(['intro', 'follow_up', 'proposal', 'campaign_announcement', 'review_request', 'custom']),
  recipientName: z.string().trim().max(120).optional(),
  recipientBusiness: z.string().trim().max(160).optional(),
  brief: z.string().trim().max(1500).optional(),
  campaignId: z.string().uuid().optional(),
});

export const POST = handler(async (req, _ctx, auth) => {
  enforceRateLimit(`email-draft:${auth.user.id}`, 25, 600);
  const body = await parseBody(req, schema);
  const campaign = body.campaignId
    ? get<{ name: string; service_name: string; business_category: string; offer_price: string }>(
        'SELECT name, service_name, business_category, offer_price FROM campaigns WHERE id = ? AND user_id = ?',
        body.campaignId,
        auth.user.id
      )
    : undefined;

  const draft = await draftEmail({
    userId: auth.user.id,
    template: body.template,
    recipientName: body.recipientName,
    recipientBusiness: body.recipientBusiness,
    brief: body.brief,
    campaign: campaign
      ? {
          name: campaign.name,
          serviceName: campaign.service_name,
          businessCategory: campaign.business_category,
          offerPrice: campaign.offer_price,
        }
      : null,
  });
  return jsonOk(draft);
});
