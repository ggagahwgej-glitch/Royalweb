import 'server-only';
import { getSettings, businessProfile } from '@/lib/settings';
import { resolveProvider } from '@/lib/ai/providers';
import { EXPERT_SYSTEM_PROMPT } from '@/lib/ai/expertise';
import { readEmailConfig } from './config';
import { renderEmail, type TemplateId, type EmailTemplateContext } from './templates';

/**
 * Email drafts.
 *
 * Deterministic templates are the source of truth; a configured AI provider may
 * rewrite them, but it is told the same facts and the same prohibitions. If it
 * fails, the template version is returned with a notice — never an empty body.
 */
export interface DraftRequest {
  userId: string;
  template: TemplateId;
  recipientName?: string;
  recipientBusiness?: string;
  brief?: string;
  campaign?: { name: string; serviceName: string; businessCategory: string; offerPrice: string } | null;
}

export interface DraftResult {
  subject: string;
  body: string;
  template: TemplateId;
  mode: 'template' | 'ai';
  notices: string[];
}

export async function draftEmail(input: DraftRequest): Promise<DraftResult> {
  const settings = getSettings(input.userId);
  const business = businessProfile(settings);
  const emailConfig = readEmailConfig();

  const ctx: EmailTemplateContext = {
    businessName: business.businessName,
    senderName: emailConfig.fromName || business.businessName,
    tagline: business.tagline,
    websiteUrl: business.websiteUrl,
    priceMin: business.priceMin,
    priceMax: business.priceMax,
    cta: business.ctaPrimary,
    postalAddress: emailConfig.postalAddress,
    unsubscribeUrl: emailConfig.unsubscribeUrl,
    recipientName: input.recipientName,
    recipientBusiness: input.recipientBusiness,
    category: input.campaign?.businessCategory ?? business.targetCustomers[0],
    serviceName: input.campaign?.serviceName ?? business.services[0],
    customNote: input.brief,
  };

  const rendered = renderEmail(input.template, ctx);
  const notices: string[] = [];

  if (!emailConfig.postalAddress) {
    notices.push('No postal address is configured — add one in Settings → Email before sending commercially.');
  }
  if (!emailConfig.unsubscribeUrl) {
    notices.push('No unsubscribe URL configured — the footer falls back to a reply-to-opt-out line.');
  }

  const provider = resolveProvider(settings.aiProvider, settings.aiModel);
  if (!provider) {
    notices.push('Drafted with the built-in professional templates (no AI provider configured).');
    return { ...rendered, mode: 'template', notices };
  }

  try {
    const res = await provider.chat(
      [
        { role: 'system', content: EXPERT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Rewrite this business email so it reads like a thoughtful human wrote it to one specific person.`,
            `Keep every fact, price and promise exactly. Do not add claims, statistics, deadlines or links.`,
            `Keep it under 180 words in the body, plain text, one ask, no markdown, no emojis.`,
            `Keep the signature block and the opt-out line exactly as supplied.`,
            ``,
            `Facts you may use:`,
            JSON.stringify(
              {
                business: business.businessName,
                services: business.services,
                priceMin: business.priceMin,
                priceMax: business.priceMax,
                website: business.websiteUrl,
                recipientName: input.recipientName ?? '',
                recipientBusiness: input.recipientBusiness ?? '',
                brief: input.brief ?? '',
              },
              null,
              2
            ),
            ``,
            `Current subject: ${rendered.subject}`,
            `Current body:`,
            rendered.body,
            ``,
            `Return exactly two blocks:`,
            `SUBJECT: <one line>`,
            `BODY:`,
            `<the email body>`,
          ].join('\n'),
        },
      ],
      { maxTokens: 900, temperature: 0.6 }
    );

    const text = res.text.trim();
    const subject = /SUBJECT:\s*(.+)/i.exec(text)?.[1]?.trim();
    const body = /BODY:\s*([\s\S]*)/i.exec(text)?.[1]?.trim();
    if (!subject || !body || body.length < 80) throw new Error('AI returned an unusable draft');
    return { subject: subject.slice(0, 180), body, template: input.template, mode: 'ai', notices };
  } catch (err) {
    notices.push(`AI rewrite failed (${(err as Error).message.slice(0, 160)}). The template draft is shown instead.`);
    return { ...rendered, mode: 'template', notices };
  }
}
