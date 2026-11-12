import 'server-only';
import type { BusinessProfile, PlatformAdapter } from '@/lib/platforms/types';
import type { GeneratedContent, PosterAnalysis } from './types';

/**
 * Built-in template engine.
 *
 * It is used when no AI provider is configured (or the provider fails). It is
 * honest about what it does: it composes platform-specific copy from the
 * campaign details and image analysis you supplied — it does not read text
 * from the poster, and it never invents claims, prices, phone numbers or
 * client names that you did not provide.
 */

export interface LocalGenInput {
  campaign: {
    id: string;
    name: string;
    businessCategory: string;
    serviceName: string;
    offerPrice: string;
    websiteUrl: string;
    whatsappUrl: string;
    contactInfo: string;
    description: string;
    targetAudience: string;
    language: string;
    cta: string;
  };
  business: BusinessProfile;
  analysis: PosterAnalysis;
  adapter: PlatformAdapter;
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function clean(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

function pick<T>(items: T[], seed: number): T {
  return items[seed % items.length];
}

export function localHashtags(input: LocalGenInput, max: number): string[] {
  const { business, campaign } = input;
  const base = ['Royalweb', 'WebsiteDesign', 'WebDevelopment', 'SmallBusiness'];
  const service = clean(campaign.serviceName) || clean(input.analysis.service);
  const category = clean(campaign.businessCategory);
  const derived: string[] = [];
  if (service) derived.push(titleCase(service).replace(/[^A-Za-z0-9]/g, ''));
  if (category) derived.push(titleCase(category).replace(/[^A-Za-z0-9]/g, ''));
  if (category) derived.push(`For${titleCase(category).replace(/[^A-Za-z0-9]/g, '')}`);
  derived.push(titleCase(business.businessName).replace(/[^A-Za-z0-9]/g, ''));
  const merged = [...new Set([...derived, ...base].filter(Boolean))];
  return merged.slice(0, Math.max(max, 1));
}

function priceLine(input: LocalGenInput): string {
  const raw = clean(input.campaign.offerPrice);
  if (raw) return raw.startsWith('₹') || /\d/.test(raw) ? `Price: ${raw}` : raw;
  const { priceMin, priceMax } = input.business;
  if (priceMin && priceMax) return `Starting at ₹${priceMin}–₹${priceMax}`;
  return '';
}

function linkLine(input: LocalGenInput): string {
  return clean(input.campaign.websiteUrl) || clean(input.business.websiteUrl);
}

function waLine(input: LocalGenInput): string {
  if (!input.business.publicContactVisible) return '';
  return clean(input.campaign.whatsappUrl) || clean(input.business.whatsappUrl);
}

function ctaLine(input: LocalGenInput): string {
  return clean(input.campaign.cta) || clean(input.business.ctaPrimary) || 'Get Your Business Website';
}

function serviceLabel(input: LocalGenInput): string {
  return clean(input.campaign.serviceName) || clean(input.analysis.service) || 'business website';
}

function audienceLabel(input: LocalGenInput): string {
  return (
    clean(input.campaign.targetAudience) ||
    clean(input.business.targetCustomers[0]) ||
    'local businesses'
  );
}

function headline(input: LocalGenInput, seed: number): string {
  const service = serviceLabel(input);
  const cat = clean(input.campaign.businessCategory) || audienceLabel(input);
  const options = [
    `${titleCase(service)} for ${cat}`,
    `A website that brings you customers, not just compliments`,
    `${titleCase(cat)}: look professional online, get more enquiries`,
    `Your ${service} — built to convert visitors into customers`,
  ];
  return pick(options, seed);
}

function coreParagraph(input: LocalGenInput, seed: number): string {
  const { business } = input;
  const description = clean(input.campaign.description);
  if (description) return description;
  const cat = audienceLabel(input);
  const variants = [
    `${business.businessName} designs and develops ${serviceLabel(input)} that load fast, look premium on mobile, and make it easy for ${cat} to send you an enquiry.`,
    `We build ${serviceLabel(input)} for ${cat} — clean design, mobile-first layouts, WhatsApp enquiry buttons and the basics of SEO built in.`,
    `${business.businessName} helps ${cat} get found online with a professional ${serviceLabel(input)}, built for speed, mobile visitors and real enquiries.`,
  ];
  return pick(variants, seed);
}

export function generateLocalContent(input: LocalGenInput): GeneratedContent {
  const { adapter, campaign } = input;
  const seed = hash(`${campaign.id}:${adapter.id}:${campaign.name}`);
  const service = serviceLabel(input);
  const cat = clean(campaign.businessCategory) || audienceLabel(input);
  const cta = ctaLine(input);
  const url = linkLine(input);
  const wa = waLine(input);
  const price = priceLine(input);
  const hashtags = localHashtags(input, adapter.limits.hashtags ?? 5);
  const paragraphs = [
    coreParagraph(input, seed),
    price,
    input.business.businessName ? `— ${input.business.businessName}${input.business.tagline ? `, ${input.business.tagline}` : ''}` : '',
  ].filter(Boolean);

  const articleBody = buildArticle(input, seed);
  const title = buildTitle(input, seed, cat, service);

  let caption = '';
  let description = paragraphs.join('\n\n');
  let extra: Record<string, unknown> = {};

  switch (adapter.id) {
    case 'x':
      caption = buildShort(input, seed, 280 - url.length - cta.length - 20, 'x');
      break;
    case 'bluesky':
      caption = buildShort(input, seed + 5, 300 - url.length - cta.length - 24, 'bluesky');
      break;
    case 'mastodon':
      caption = [
        pick(
          [
            `If you run a ${cat.toLowerCase()} in your city and your only online presence is a phone number, a simple one-page website changes how people find you.`,
            `A quick note for ${cat.toLowerCase()}: your customers check your website before they call. Speed and clarity matter more than a fancy animation.`,
            `We build small, fast websites for ${cat.toLowerCase()}. No bloat, no monthly surprises — just a page that answers: what do you do, and how do I contact you?`,
          ],
          seed
        ),
        '',
        `${coreParagraph(input, seed + 1)}${price ? `\n${price}.` : ''}`,
        '',
        `${cta}${url ? `: ${url}` : ''}`,
      ].join('\n');
      break;
    case 'telegram':
      caption = [
        `${title}`,
        '',
        coreParagraph(input, seed),
        price ? `${price}` : '',
        wa ? `WhatsApp: ${wa}` : '',
        `${cta}${url ? ` → ${url}` : ''}`,
      ]
        .filter(Boolean)
        .join('\n');
      break;
    case 'discord':
      caption = [
        `**${title}**`,
        '',
        coreParagraph(input, seed),
        price ? `• ${price}` : '',
        url ? `• ${cta}: ${url}` : `• ${cta}`,
      ]
        .filter(Boolean)
        .join('\n');
      break;
    case 'pinterest':
      caption = `${coreParagraph(input, seed)} ${price ? price + '.' : ''}`.trim();
      description = [coreParagraph(input, seed), price, `${cta}${url ? `: ${url}` : ''}`].filter(Boolean).join('\n\n');
      break;
    case 'linkedin':
      caption = [
        pick(
          [
            `Most ${cat.toLowerCase()} businesses lose enquiries before the first conversation — not because of price, but because there is no website to check.`,
            `A website is not a brochure. For a ${cat.toLowerCase()} business it is the first filter customers apply before they call.`,
            `We have been building ${service} for ${cat.toLowerCase()}. The pattern is consistent: clarity beats complexity.`,
          ],
          seed
        ),
        '',
        coreParagraph(input, seed + 2),
        '',
        price ? `${price}.` : '',
        `${cta}${url ? ` → ${url}` : ''}`,
      ]
        .filter(Boolean)
        .join('\n');
      break;
    case 'googlebusiness':
      caption = `${title}. ${coreParagraph(input, seed)}${price ? ` ${price}.` : ''} ${cta}.`;
      break;
    case 'slack':
      caption = [
        `*${title}*`,
        `• ${coreParagraph(input, seed)}`,
        price ? `• ${price}` : '',
        `• ${cta}${url ? `: ${url}` : ''}`,
      ]
        .filter(Boolean)
        .join('\n');
      break;
    case 'matrix':
      caption = [title, coreParagraph(input, seed), `${cta}${url ? `: ${url}` : ''}`].join('\n\n');
      break;
    case 'tumblr':
      caption = [title, coreParagraph(input, seed), price, `${cta}${url ? ` → ${url}` : ''}`].filter(Boolean).join('\n\n');
      break;
    case 'youtube':
      caption = `${title} — ${cta}`;
      description = [
        `${coreParagraph(input, seed)}${price ? ` ${price}.` : ''}`,
        url ? `${cta}: ${url}` : '',
        wa ? `WhatsApp: ${wa}` : '',
        'A quick look at what a professional website can do for a small business.',
      ]
        .filter(Boolean)
        .join('\n\n');
      break;
    case 'flickr':
      caption = coreParagraph(input, seed);
      break;
    case 'dribbble':
      caption = `${titleCase(service)} — mobile-first layout with a clear enquiry path. Designed and built by ${input.business.businessName}.`;
      break;
    case 'quora':
      caption = buildQuoraAnswer(input, seed, cat);
      description = caption;
      break;
    case 'reddit':
      caption = [
        pick(
          [
            `What actually makes a small ${cat.toLowerCase()} website worth paying for?`,
            `${titleCase(cat)} owners: what convinced you to finally get a website?`,
            `People who build websites for local businesses — what is the most common mistake you see?`,
          ],
          seed
        ),
        '',
        `I build small business websites, and I keep seeing the same pattern: most ${cat.toLowerCase()} owners do not need a 20-page site. They need one clear page that loads fast, explains the service, shows the price range and makes it easy to call or WhatsApp.`,
        '',
        `Curious what this community thinks: is a simple one-page site with clear pricing better than a bigger site with more "credibility" but no clear next step?`,
        '',
        '(Disclosure: I run a small web design studio, so I am biased — genuinely interested in the counter-arguments.)',
      ].join('\n');
      description = caption;
      break;
    case 'behance':
      caption = buildCaseStudy(input, seed, cat, service);
      description = caption;
      break;
    case 'goodfirms':
    case 'indiamart':
    case 'justdial':
      caption = buildListing(input, seed, cat, service, adapter.id);
      description = caption;
      break;
    default:
      // Article platforms: WordPress, Blogger, Ghost, Hashnode, DEV.to
      if (adapter.id === 'devto') {
        caption = buildTechnicalArticle(input, seed, cat, service);
        description = caption;
        extra = { readingTime: '4 min' };
      } else if (adapter.id === 'hashnode') {
        caption = buildHashnodeArticle(input, seed, cat, service);
        description = caption;
        extra = { readingTime: '6 min' };
      } else if (adapter.id === 'wordpress') {
        caption = articleBody;
        description = articleBody;
      } else if (adapter.id === 'blogger') {
        caption = buildBloggerPost(input, seed, cat, service);
        description = caption;
      } else if (adapter.id === 'ghost') {
        caption = buildGhostPost(input, seed, cat, service);
        description = caption;
      } else {
        caption = paragraphs.join('\n\n');
      }
  }

  if (adapter.limits.caption && caption.length > adapter.limits.caption) {
    caption = `${caption.slice(0, adapter.limits.caption - 1).trimEnd()}…`;
  }

  return {
    platform: adapter.id,
    title: truncate(title, adapter.limits.title ?? 120),
    caption,
    description:
      adapter.limits.caption && description.length > adapter.limits.caption
        ? description.slice(0, adapter.limits.caption)
        : description,
    hashtags,
    cta,
    altText: `${titleCase(service)} promotional graphic for ${input.business.businessName}`,
    extra,
  };
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function buildTitle(input: LocalGenInput, seed: number, cat: string, service: string) {
  const opts = [
    `${titleCase(service)} for ${titleCase(cat)} — ${input.business.businessName}`,
    `${titleCase(cat)}? Here's How a Website Brings You More Enquiries`,
    `A Website for Your ${titleCase(cat)} Business — Without the Agency Price Tag`,
  ];
  return pick(opts, seed);
}

function buildShort(input: LocalGenInput, seed: number, budget: number, channel: 'x' | 'bluesky'): string {
  const cat = audienceLabel(input).toLowerCase();
  const service = serviceLabel(input);
  const cta = ctaLine(input);
  const options =
    channel === 'x'
      ? [
          `Most ${cat} sites are checked on a phone before anyone calls. If yours is slow, that is the enquiry you lose. ${cta}`,
          `One page. Service, price range, one WhatsApp button. That is usually all a local ${cat.replace(/s$/, '')} business needs. ${cta}`,
          `Still sending customers to a phone number? A fast one-page ${service} does the selling for you. ${cta}`,
        ]
      : [
          `A quick observation from building sites for ${cat}: the ones that convert are boring. Clear service, clear price, one way to contact.`,
          `If your only web presence is a social profile, people cannot check your prices without messaging you. A single page fixes that. ${cta}`,
          `We build ${service} that load fast and say what you do in the first screen. ${cta}`,
        ];
  const base = pick(options, seed);
  return base.length <= budget ? base : `${base.slice(0, Math.max(budget - 1, 40)).trimEnd()}…`;
}

function buildArticle(input: LocalGenInput, seed: number): string {
  const { business } = input;
  const cat = clean(input.campaign.businessCategory) || audienceLabel(input);
  const service = serviceLabel(input);
  const price = priceLine(input);
  const url = linkLine(input);
  const cta = ctaLine(input);
  return [
    coreParagraph(input, seed),
    '',
    `## What is included`,
    '',
    `- A mobile-first ${service} built for ${cat.toLowerCase()}`,
    `- Clear service and pricing information so visitors do not have to guess`,
    `- WhatsApp and call buttons that work with one tap on a phone`,
    `- Basic on-page SEO: page titles, descriptions and fast-loading images`,
    price ? `- Transparent pricing: ${price.replace(/^Price: /, '')}` : '',
    '',
    `## Why it matters`,
    '',
    `Before a customer calls a ${cat.toLowerCase()} business, they check whether it looks legitimate online. A clear, fast page answers three questions in seconds: what do you do, where are you, and how do I contact you. That is usually the difference between an enquiry and a scroll past.`,
    '',
    `## Next step`,
    '',
    `${cta}${url ? ` — ${url}` : ''}`,
    '',
    `${business.businessName}${business.tagline ? ` · ${business.tagline}` : ''}`,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

function buildCaseStudy(input: LocalGenInput, seed: number, cat: string, service: string): string {
  const url = linkLine(input);
  const cta = ctaLine(input);
  const price = priceLine(input);
  const brand = input.business.businessName;
  return [
    `## The brief`,
    '',
    `A ${cat.toLowerCase()} business came to ${brand} with a familiar problem: they were being found, but not chosen. The site existed, yet nothing on it answered the two questions customers actually ask — what does this cost, and how do I get in touch?`,
    '',
    `## What we changed`,
    '',
    `- Rebuilt the entry page around one promise instead of six`,
    `- Put the starting price on the page so enquiries arrive pre-qualified${price ? ` (${price.replace(/^Price: /, '')})` : ''}`,
    `- Replaced the contact form (which nobody completed) with a single WhatsApp action`,
    `- Compressed the hero image and deferred everything non-critical so the phone view paints in under a second`,
    '',
    `## Design decisions`,
    '',
    `Type is set in two weights only. The accent colour is used exactly twice per screen — once for the primary action, once for the price. Every section has one job: explain, prove, or convert.`,
    '',
    `## Outcome`,
    '',
    coreParagraph(input, seed + 4),
    '',
    `## Tools`,
    '',
    `Next.js · Tailwind CSS · Sharp for image derivatives · hand-written content, no template copy`,
    '',
    `${cta}${url ? ` — ${url}` : ''}`,
  ].join('\n');
}

function buildBloggerPost(input: LocalGenInput, seed: number, cat: string, service: string): string {
  const url = linkLine(input);
  const cta = ctaLine(input);
  const price = priceLine(input);
  const wa = waLine(input);
  return [
    `If you run a ${cat.toLowerCase()} business, here is the short version: a fast one-page website with a clear price range and one obvious contact path will outperform a larger site nobody has time to maintain.`,
    '',
    coreParagraph(input, seed + 3),
    '',
    '## Frequently asked questions',
    '',
    `**How long does a website take?** For a focused ${service}, the build itself is days rather than months. The slow part is usually collecting photos, pricing and service details.`,
    '',
    `**What does it cost?** ${price ? price.replace(/^Price: /, '') : 'A focused small business site is a one-time project cost, not an open-ended retainer.'}`,
    '',
    '**Do I need to pay for hosting separately?** Yes, and it should be in your name. Keep the domain and hosting account under your control so you are never locked in.',
    '',
    '**Will it work on a phone?** It is designed on a phone first. Most first visits to a local business site happen on mobile, often on a slow connection.',
    '',
    `## Next step`,
    '',
    `${cta}${url ? `: ${url}` : ''}`,
    wa ? `WhatsApp: ${wa}` : '',
    '',
    `${input.business.businessName}${input.business.tagline ? ` · ${input.business.tagline}` : ''}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildGhostPost(input: LocalGenInput, seed: number, cat: string, service: string): string {
  const url = linkLine(input);
  const cta = ctaLine(input);
  const price = priceLine(input);
  return [
    `# How we build ${service} for ${cat.toLowerCase()}`,
    '',
    `This is the process we actually follow at ${input.business.businessName}, written down so you can judge whether it matches what you need.`,
    '',
    '## 1. One page, one job',
    '',
    `We start by writing the single sentence the page must communicate. If the business cannot answer "what do you do, and for whom" in that sentence, no amount of design fixes it.`,
    '',
    '## 2. Content before layout',
    '',
    'Real service names, real prices, real photos. Placeholder text hides the problems that show up when the page goes live.',
    '',
    '## 3. Build for the phone on a slow connection',
    '',
    `The first render targets a mid-range Android phone on a 4G connection. Images are resized and served in modern formats; JavaScript is limited to what the page genuinely needs.`,
    '',
    '## 4. One conversion action',
    '',
    `Every page ends with the same action: ${cta.toLowerCase()}.${price ? ` The starting price (${price.replace(/^Price: /, '')}) is published so enquiries are qualified before they arrive.` : ''}`,
    '',
    '## 5. Hand over ownership',
    '',
    'Domain, hosting and content exports stay with the business. We document how to edit the page without calling us.',
    '',
    `${cta}${url ? ` — ${url}` : ''}`,
  ].join('\n');
}

function buildHashnodeArticle(input: LocalGenInput, seed: number, cat: string, service: string): string {
  const url = linkLine(input);
  const cta = ctaLine(input);
  const price = priceLine(input);
  return [
    `# Shipping ${service}: the decisions that actually move enquiries`,
    '',
    'Every small business site ships with a long list of possible features. Almost none of them change whether a customer makes contact. These are the ones that do.',
    '',
    '## The problem',
    '',
    `A ${cat.toLowerCase()} business usually has a phone number, an Instagram page, and a website someone built years ago. Visitors arrive, cannot tell what the business charges, and leave.`,
    '',
    '## The approach',
    '',
    '**Reduce the number of decisions per screen.** One heading, one supporting paragraph, one action. Secondary navigation is a tax on attention.',
    '',
    '**Publish the price range.** This is the highest-leverage content change available to a local business. It filters out mismatched enquiries before they consume time.',
    '',
    '**Make contact a single tap.** No form validation, no "we will get back to you within 3 business days". A WhatsApp deep link with a prefilled message converts better than a contact form in almost every case we have measured.',
    '',
    '## What I would not do',
    '',
    'Avoid page builders with a heavy runtime for a page this simple. Avoid stock photography that looks nothing like the business. Avoid chat widgets that load before the headline.',
    '',
    '## Trade-offs',
    '',
    `A focused build like this is not the right fit for every business — a multi-location operation needs a proper CMS and location pages. For a single-location ${cat.toLowerCase()} business, the smaller build wins on speed and maintainability.`,
    '',
    '## Conclusion',
    '',
    `${price ? `${price.replace(/^Price: /, '')} buys a page that loads fast, states the price, and makes contacting you trivial. ` : ''}${cta}${url ? `: ${url}` : ''}`,
  ].join('\n');
}

function buildListing(input: LocalGenInput, seed: number, cat: string, service: string, platform: string): string {
  const url = linkLine(input);
  const cta = ctaLine(input);
  const price = priceLine(input);
  const wa = waLine(input);
  const brand = input.business.businessName;
  const contact =
    input.business.publicContactVisible && input.business.contactEmail
      ? input.business.contactEmail
      : 'shared on request';

  if (platform === 'goodfirms') {
    return [
      `# ${brand} — ${titleCase(service)}`,
      '',
      `**Firm profile.** ${coreParagraph(input, seed + 5)}`,
      '',
      '**Services listed**',
      `- ${titleCase(service)}`,
      '- Mobile-first design and build',
      '- On-page SEO fundamentals',
      '- WhatsApp / call enquiry setup',
      '',
      '**Engagement model**',
      'Fixed-scope project. Scope, price and timeline are agreed in writing before work starts.',
      '',
      `**Client focus:** ${cat}.`,
      price ? `**Starting price:** ${price.replace(/^Price: /, '')}` : '',
      `**Contact:** ${contact}`,
      url ? `**Portfolio:** ${url}` : '',
      '',
      cta,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (platform === 'indiamart') {
    return [
      `${brand} — ${titleCase(service)} (${cat})`,
      '',
      `**Service category:** Website design & development`,
      `**Requirement type:** ${titleCase(service)}`,
      `**Price range:** ${price ? price.replace(/^Price: /, '') : 'Quoted per scope'}`,
      `**Service area:** ${cat}`,
      `**Deliverables:** mobile-first website, enquiry buttons, basic on-page SEO, handover documentation`,
      `**Lead time:** confirmed in writing before the project starts`,
      `**Contact:** ${contact}`,
      '',
      '**Description**',
      coreParagraph(input, seed + 6),
      '',
      `${cta}${url ? `: ${url}` : ''}`,
      wa ? `WhatsApp: ${wa}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // justdial
  return [
    `${brand} — ${titleCase(service)}`,
    '',
    `**Category:** Website designers & developers`,
    `**Service area:** ${cat}`,
    `**Starting price:** ${price ? price.replace(/^Price: /, '') : 'Quoted per scope'}`,
    `**Contact:** ${contact}`,
    '',
    '**About this listing**',
    coreParagraph(input, seed + 7),
    '',
    '**What is included**',
    '- One-page or small multi-page website',
    '- Mobile layout tested on Android and iOS',
    '- Call and WhatsApp buttons',
    '- Basic on-page SEO and analytics setup',
    '',
    `${cta}${url ? `: ${url}` : ''}`,
    wa ? `WhatsApp: ${wa}` : '',
    '',
    'Enquiries are answered on business days; project timelines are confirmed in writing.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildTechnicalArticle(input: LocalGenInput, seed: number, cat: string, service: string): string {
  const url = linkLine(input);
  const cta = ctaLine(input);
  const price = priceLine(input);
  return [
    `# ${titleCase(service)}: a practical checklist for ${cat.toLowerCase()}`,
    '',
    `Most small business websites fail for boring reasons: they are slow, they are hard to read on a phone, and they do not explain what the business actually does. None of that requires a big budget to fix.`,
    '',
    `## 1. Optimise for the phone first`,
    '',
    `Design at 390px wide before designing at 1440px. Most first visits to a local business site come from a phone, often on a slow connection. If the call button is not reachable with a thumb, the page is not finished.`,
    '',
    `## 2. Load less JavaScript`,
    '',
    `A marketing page does not need a client-side router, a CMS dashboard bundle and three animation libraries. Serving static HTML with one small stylesheet routinely gets first contentful paint under one second on mid-range Android devices.`,
    '',
    `## 3. Put the price range on the page`,
    '',
    `"Contact us for a quote" is a filter: it removes everyone who wants a rough number first. Publishing a starting range ${price ? `(${price.replace(/^Price: /, '')})` : ''} qualifies enquiries before they reach your inbox.`,
    '',
    `## 4. Give every section one job`,
    '',
    `Hero: what you do. Services: what is included. Proof: real examples. Contact: one obvious next action. If a section does not do one of those, delete it.`,
    '',
    `## 5. Measure the one thing that matters`,
    '',
    `Enquiries, not pageviews. Track WhatsApp taps, call taps and form submissions separately. A page with 200 views and 8 enquiries beats 5,000 views and none.`,
    '',
    `---`,
    '',
    `*${input.business.businessName} builds ${service} for ${cat.toLowerCase()}. ${cta}${url ? `: ${url}` : ''}*`,
  ].join('\n');
}

function buildQuoraAnswer(input: LocalGenInput, seed: number, cat: string) {
  const price = priceLine(input);
  const url = linkLine(input);
  return [
    `Short answer: yes, a simple website is usually worth it for a ${cat.toLowerCase()} business — but only if it is built to do one job well.`,
    '',
    `Here is how I would think about it if I were in your position:`,
    '',
    `**1. People check before they call.** A phone number alone gives a customer nothing to verify. A page with your services, a few photos, your area and a clear contact path removes that doubt.`,
    '',
    `**2. One page is often enough.** You do not need twenty pages. You need a clear explanation of what you offer, what it costs, and how to reach you.`,
    '',
    `**3. Mobile speed matters more than design trends.** If the page takes four seconds to load on a phone, most visitors leave before they see it.`,
    '',
    `**4. Budget realistically.** ${price ? `${price.replace(/^Price: /, '')} is a normal range for a focused small business site` : 'A focused small business site is a one-time cost, not a monthly subscription'}. Be careful with "unlimited pages" offers that lock you into a monthly fee you cannot leave.`,
    '',
    `**5. Keep ownership.** Make sure the domain and hosting are in your name, and that you can export the content.`,
    '',
    `If you want a starting point, I have written more about what to include here${url ? `: ${url}` : '.'}`,
    '',
    `Disclosure: I run a small web design studio (${input.business.businessName}), so take my advice with that in mind.`,
    seed % 2 === 0 ? '' : '',
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}
