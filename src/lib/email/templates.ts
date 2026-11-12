/**
 * Professional email templates for a website-design studio.
 *
 * Written to survive a real inbox: short, specific, one ask, honest sender
 * identity, plain text, and a compliant footer. No fake "re:" subjects, no
 * false urgency, no purchased-list language.
 */

export interface EmailTemplateContext {
  businessName: string;
  senderName: string;
  tagline?: string;
  websiteUrl?: string;
  priceMin?: string;
  priceMax?: string;
  cta?: string;
  postalAddress?: string;
  unsubscribeUrl?: string;
  recipientName?: string;
  recipientBusiness?: string;
  category?: string;
  serviceName?: string;
  customNote?: string;
}

export type TemplateId = 'intro' | 'follow_up' | 'proposal' | 'campaign_announcement' | 'review_request' | 'custom';

export interface RenderedEmail {
  subject: string;
  body: string;
  template: TemplateId;
}

export const TEMPLATE_META: { id: TemplateId; label: string; purpose: string; requiresConsent: boolean }[] = [
  {
    id: 'intro',
    label: 'First contact',
    purpose: 'One specific reason you are writing, one observation, one question. No attachment, no pitch deck.',
    requiresConsent: true,
  },
  {
    id: 'follow_up',
    label: 'Follow-up',
    purpose: 'The single follow-up allowed unless they reply. Adds one new piece of value, then stops.',
    requiresConsent: true,
  },
  {
    id: 'proposal',
    label: 'Proposal / scope',
    purpose: 'Scope, price, timeline, what is excluded, and what you need from them.',
    requiresConsent: false,
  },
  {
    id: 'campaign_announcement',
    label: 'Offer announcement',
    purpose: 'For existing clients or subscribers who already opted in.',
    requiresConsent: true,
  },
  {
    id: 'review_request',
    label: 'Review request',
    purpose: 'Short thank-you plus one direct review link, sent after delivery.',
    requiresConsent: false,
  },
  { id: 'custom', label: 'Blank', purpose: 'Write from scratch.', requiresConsent: false },
];

function firstName(name?: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0];
}

function priceLine(ctx: EmailTemplateContext): string {
  if (ctx.priceMin && ctx.priceMax) return `Projects start at ₹${ctx.priceMin}–₹${ctx.priceMax} for a focused build.`;
  if (ctx.priceMin) return `Projects start at ₹${ctx.priceMin}.`;
  return '';
}

function signature(ctx: EmailTemplateContext): string {
  return [
    '',
    '—',
    ctx.senderName || ctx.businessName,
    ctx.businessName,
    ctx.websiteUrl ?? '',
    ctx.postalAddress ? `\n${ctx.postalAddress}` : '',
    ctx.unsubscribeUrl
      ? `\n\nNot useful? Unsubscribe here and I will not email again: ${ctx.unsubscribeUrl}`
      : '\n\nIf this is not relevant, reply “stop” and I will not contact you again.',
  ]
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function footerNote(ctx: EmailTemplateContext): string {
  return ctx.postalAddress
    ? ''
    : '\n\n[Add your business postal address in Settings → Email so every message carries it.]';
}

export function renderEmail(template: TemplateId, ctx: EmailTemplateContext): RenderedEmail {
  const name = firstName(ctx.recipientName);
  const theirBusiness = (ctx.recipientBusiness || ctx.category || 'your business').trim();
  const service = (ctx.serviceName || 'a business website').trim();
  const price = priceLine(ctx);
  const cta = ctx.cta || 'Get Your Business Website';

  switch (template) {
    case 'intro':
      return {
        template,
        subject: `${theirBusiness} — one observation about being found online`,
        body: [
          `Hi ${name},`,
          '',
          `I run ${ctx.businessName}, a small website studio. I am not writing with a template blast — I looked at ${theirBusiness} and one thing stood out: people who find you have nowhere to check what you do and roughly what it costs before they call.`,
          '',
          ctx.customNote?.trim() ||
            `That single gap is usually worth fixing before anything else — not a redesign, just one clear page that answers: what you do, where you work, what it costs, and how to reach you.`,
          '',
          price,
          '',
          `If it is useful, I can send two or three specific observations for ${theirBusiness} — no call required. Would that help?`,
          '',
          signature(ctx),
          footerNote(ctx),
        ]
          .filter((line) => line !== '')
          .join('\n'),
      };

    case 'follow_up':
      return {
        template,
        subject: `Following up once — ${theirBusiness}`,
        body: [
          `Hi ${name},`,
          '',
          `Following up once on my note about ${theirBusiness}. If a website is not a priority this quarter, that is a perfectly good answer — just tell me and I will close the loop.`,
          '',
          ctx.customNote?.trim() ||
            `One thing worth knowing either way: a starting price on the page removes most of the back-and-forth before a customer calls. It is the cheapest change available to a local business.`,
          '',
          `Worth a short reply?`,
          '',
          signature(ctx),
          footerNote(ctx),
        ]
          .filter((line) => line !== '')
          .join('\n'),
      };

    case 'proposal':
      return {
        template,
        subject: `Scope and price — ${service} for ${theirBusiness}`,
        body: [
          `Hi ${name},`,
          '',
          `Here is the scope we discussed, in writing, so there are no surprises.`,
          '',
          `What is included`,
          `• One-page ${service}, designed mobile-first`,
          `• Your services, service area, and a price range on the page`,
          `• Call and WhatsApp buttons that work with one tap`,
          `• Basic on-page SEO: title, description, fast images`,
          `• Handover: domain, hosting and content stay in your name`,
          '',
          `What is not included`,
          `• Copywriting beyond the page content, paid ads, monthly maintenance, logo design`,
          '',
          `Price and timing`,
          price || 'Price is quoted per scope.',
          `Timeline is confirmed once photos and service details are with us.`,
          '',
          `What I need from you`,
          `• 3–6 real photos of the work`,
          `• Your service list and service area`,
          `• The phone/WhatsApp number customers should reach`,
          '',
          `If this matches what you need, reply “go ahead” and I will send the next step.`,
          '',
          signature(ctx),
          footerNote(ctx),
        ]
          .filter((line) => line !== '')
          .join('\n'),
      };

    case 'campaign_announcement':
      return {
        template,
        subject: ctx.customNote?.trim() ? ctx.customNote.trim().slice(0, 90) : `A small update from ${ctx.businessName}`,
        body: [
          `Hi ${name},`,
          '',
          `You are on this list because you have worked with ${ctx.businessName} before — this is the only kind of email I send.`,
          '',
          ctx.customNote?.trim() ||
            `${service} for ${theirBusiness} is available this month. ${price}`,
          '',
          `${cta}${ctx.websiteUrl ? `: ${ctx.websiteUrl}` : ''}`,
          '',
          signature(ctx),
          footerNote(ctx),
        ]
          .filter((line) => line !== '')
          .join('\n'),
      };

    case 'review_request':
      return {
        template,
        subject: `Quick favour — one line about working together?`,
        body: [
          `Hi ${name},`,
          '',
          `The site is live and the handover is done. If the process was straightforward, a short review helps other local businesses decide whether this is for them. One or two lines is plenty.`,
          '',
          ctx.customNote?.trim() || '',
          '',
          `If anything is still not right, tell me first — I would rather fix it than have you write around it.`,
          '',
          signature(ctx),
          footerNote(ctx),
        ]
          .filter((line) => line !== '')
          .join('\n'),
      };

    default:
      return {
        template: 'custom',
        subject: '',
        body: ['Hi ' + name + ',', '', ctx.customNote ?? '', '', signature(ctx), footerNote(ctx)]
          .filter((line) => line !== '')
          .join('\n'),
      };
  }
}

/** Plain-text → minimal, safe HTML (no external assets, no tracking pixels). */
export function toHtml(body: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n').map(escape);
      return `<p style="margin:0 0 14px;line-height:1.6">${lines.join('<br>')}</p>`;
    })
    .join('');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#16161a;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px">${paragraphs}</body></html>`;
}
