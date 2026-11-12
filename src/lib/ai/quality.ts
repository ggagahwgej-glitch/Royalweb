import type { GeneratedContent } from './types';

/**
 * Editorial quality gate.
 *
 * Runs over every draft (AI or template) before it reaches the review screen.
 * It removes the patterns that make business copy read like spam or like a bot
 * wrote it, and reports anything that still needs a human's judgement.
 *
 * It never invents content: it only normalises, trims and flags.
 */

export interface QualityIssue {
  severity: 'error' | 'warning' | 'fixed';
  code: string;
  message: string;
}

export interface QualityResult {
  content: GeneratedContent;
  issues: QualityIssue[];
}

export interface QualityLimits {
  caption?: number;
  title?: number;
  hashtags?: number;
}

const SPAM_PHRASES: { pattern: RegExp; label: string }[] = [
  { pattern: /\bact now\b/gi, label: '“act now” urgency' },
  { pattern: /\bclick here\b/gi, label: '“click here” button language' },
  { pattern: /\bdm me (fast|now)\b/gi, label: '“DM me fast”' },
  { pattern: /\b100% (guaranteed|free|safe)\b/gi, label: 'absolute guarantee' },
  { pattern: /\blimited time only\b/gi, label: 'invented scarcity' },
  { pattern: /\bbuy now\b/gi, label: '“buy now”' },
  { pattern: /\bonly \d+ (slots|spots) left\b/gi, label: 'invented scarcity' },
  { pattern: /\bguaranteed (results|traffic|sales|rankings)\b/gi, label: 'guaranteed results' },
  { pattern: /\bno\.? ?1 (agency|company|studio) in\b/gi, label: 'unverifiable ranking claim' },
];

const PLACEHOLDER = /\{\{[^}]*\}\}|\bundefined\b|\bTODO\b|\bTBD\b|\[insert[^\]]*\]/i;

const ACRONYMS = new Set([
  'SEO', 'SEM', 'CRM', 'API', 'URL', 'HTML', 'CSS', 'JS', 'UI', 'UX', 'AI', 'GST', 'INR', 'ROI',
  'CTA', 'FAQ', 'PDF', 'SSL', 'CDN', 'HTTP', 'HTTPS', 'ID', 'OK', 'ROYALWEB', 'WHATSAPP',
]);

function normalise(input: string): string {
  return input
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/…{2,}/g, '…')
    .replace(/!{3,}/g, '!')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function deShout(text: string): { text: string; shouted: boolean } {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 24) return { text, shouted: false };
  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (upper / letters.length < 0.55) return { text, shouted: false };
  const converted = text.replace(/\b[A-Z]{4,}\b/g, (word) =>
    ACRONYMS.has(word) ? word : word[0] + word.slice(1).toLowerCase()
  );
  return { text: converted, shouted: converted !== text };
}

function emojiCount(text: string): number {
  const matches = text.match(/\p{Extended_Pictographic}/gu);
  return matches ? matches.length : 0;
}

function capEmojis(text: string, max: number): { text: string; removed: number } {
  const matches = [...text.matchAll(/\p{Extended_Pictographic}/gu)];
  if (matches.length <= max) return { text, removed: 0 };
  let removed = 0;
  const out = text.replace(/\p{Extended_Pictographic}/gu, (match) => {
    removed += 1;
    return removed <= max ? match : '';
  });
  return { text: out.replace(/[ \t]{2,}/g, ' ').trim(), removed: matches.length - max };
}

function clip(value: string, max?: number): string {
  if (!max || value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export function reviewContent(
  input: GeneratedContent,
  limits: QualityLimits,
  opts: { platformLabel?: string } = {}
): QualityResult {
  const issues: QualityIssue[] = [];
  const label = opts.platformLabel ?? input.platform;

  let caption = normalise(String(input.caption ?? ''));
  let description = normalise(String(input.description ?? ''));
  let title = normalise(String(input.title ?? ''));

  if (PLACEHOLDER.test(caption) || PLACEHOLDER.test(description) || PLACEHOLDER.test(title)) {
    issues.push({
      severity: 'error',
      code: 'placeholder',
      message: `${label}: a placeholder or undefined value was found and removed — review this draft before approving.`,
    });
    const scrub = (v: string) => v.replace(PLACEHOLDER, '').replace(/[ \t]{2,}/g, ' ').trim();
    caption = scrub(caption);
    description = scrub(description);
    title = scrub(title);
  }

  for (const { pattern, label: spamLabel } of SPAM_PHRASES) {
    if (pattern.test(caption) || pattern.test(description)) {
      caption = caption.replace(pattern, '');
      description = description.replace(pattern, '');
      issues.push({
        severity: 'fixed',
        code: 'spam_phrase',
        message: `${label}: removed ${spamLabel}.`,
      });
    }
    pattern.lastIndex = 0;
  }
  caption = caption.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  const shout = deShout(caption);
  if (shout.shouted) {
    caption = shout.text;
    issues.push({ severity: 'fixed', code: 'shouting', message: `${label}: removed ALL-CAPS shouting.` });
  }

  if (emojiCount(caption) > 4) {
    const capped = capEmojis(caption, 4);
    caption = capped.text;
    issues.push({ severity: 'fixed', code: 'emoji', message: `${label}: trimmed ${capped.removed} emoji.` });
  }

  const urls = caption.match(/https?:\/\/\S+/g) ?? [];
  if (urls.length > 1) {
    issues.push({
      severity: 'warning',
      code: 'multiple_links',
      message: `${label}: ${urls.length} links in one post. Most platforms suppress reach when posts compete for exits.`,
    });
  }

  const numericClaim = /\b\d+(\.\d+)?\s*(%|x|times)\b/i.test(caption);
  if (numericClaim) {
    issues.push({
      severity: 'warning',
      code: 'numeric_claim',
      message: `${label}: contains a numeric claim — confirm you can substantiate it before publishing.`,
    });
  }

  const guaranteed = /guarantee|assured results|risk[- ]free/i.test(caption);
  if (guaranteed) {
    issues.push({
      severity: 'warning',
      code: 'guarantee',
      message: `${label}: mentions a guarantee. Only keep it if the terms are real and written down.`,
    });
  }

  if (!caption.trim()) {
    issues.push({ severity: 'error', code: 'empty', message: `${label}: the caption is empty after clean-up.` });
  }

  const tags = Array.isArray(input.hashtags)
    ? [...new Set(input.hashtags.map((h) => String(h).replace(/^#/, '').replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean))]
    : [];
  if (limits.hashtags && tags.length > limits.hashtags) {
    issues.push({
      severity: 'fixed',
      code: 'hashtags',
      message: `${label}: kept ${limits.hashtags} hashtags of ${tags.length}.`,
    });
  }

  const clippedCaption = clip(caption, limits.caption);
  if (clippedCaption !== caption) {
    issues.push({
      severity: 'fixed',
      code: 'caption_limit',
      message: `${label}: caption trimmed to the platform limit (${limits.caption} characters).`,
    });
  }

  return {
    content: {
      ...input,
      title: clip(title, limits.title ?? 200),
      caption: clippedCaption,
      description: clip(description, Math.max(limits.caption ?? 2000, 2000)),
      hashtags: tags.slice(0, limits.hashtags ?? 5),
      altText: clip(String(input.altText || title || caption).slice(0, 280), 300),
      cta: clip(String(input.cta ?? ''), 160),
    },
    issues,
  };
}

/**
 * Different platforms must never receive the same caption. The template engine
 * already aims for that, but short-form platforms share a budget, so a collision
 * is possible. This appends a platform-appropriate closing line instead of
 * shipping duplicate copy — and reports that it happened.
 */
const COLLISION_CLOSERS: Record<string, string> = {
  x: 'Built for a phone first, not a desktop.',
  bluesky: 'Curious what other local owners have found.',
  mastodon: 'Happy to go deeper on the build if useful.',
  linkedin: 'Interested in how other studios scope this.',
  telegram: 'Questions welcome — just reply here.',
  discord: 'Say hello in the channel if you want the details.',
  whatsapp: '',
  pinterest: 'Save it for when the redesign comes up.',
  flickr: 'Shot and built by the studio.',
  youtube: 'Full walkthrough linked in the description.',
  slack: 'Ping the thread if you want the long version.',
  matrix: 'Discussion welcome in the room.',
  tumblr: 'More of the process on the blog.',
  quora: 'Happy to expand if you have a specific case.',
  reddit: 'Curious how others here have handled it.',
  behance: 'Full case study available on request.',
  dribbble: 'Details on the build available on request.',
  googlebusiness: 'Call or message to discuss your business.',
  indiamart: 'Ask for a written quote with scope and timeline.',
  justdial: 'Enquiries answered on business days.',
  goodfirms: 'References and scope available on request.',
  wordpress: 'More practical notes on the blog.',
  blogger: 'More on this in the archive.',
  ghost: 'Written up as part of our build notes.',
  devto: 'Feedback welcome — especially counter-examples.',
  hashnode: 'Happy to compare notes with other teams.',
};

export function ensureUniqueCaptions(
  contents: GeneratedContent[],
  labels: Record<string, string>
): { contents: GeneratedContent[]; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  const out = contents.map((content) => {
    if (!seen.has(content.caption)) {
      seen.add(content.caption);
      return content;
    }
    const label = labels[content.platform] ?? content.platform;
    const closer = COLLISION_CLOSERS[content.platform] ?? 'Shared from our studio.';
    let caption = `${content.caption}\n\n${closer}`.trim();
    if (seen.has(caption)) caption = `${caption} ${label}`;
    seen.add(caption);
    issues.push({
      severity: 'fixed',
      code: 'duplicate_caption',
      message: `${label}: identical short-form copy was detected and given a platform-specific closing line.`,
    });
    return { ...content, caption };
  });
  return { contents: out, issues };
}

/** Aggregate per-platform issues into user-facing notices (deduplicated, capped). */
export function summariseQuality(results: { platform: string; issues: QualityIssue[] }[]): string[] {
  const errors = results.flatMap((r) => r.issues.filter((i) => i.severity === 'error'));
  const fixed = results.flatMap((r) => r.issues.filter((i) => i.severity === 'fixed'));
  const warnings = results.flatMap((r) => r.issues.filter((i) => i.severity === 'warning'));
  const notices: string[] = [];
  if (errors.length) {
    notices.push(
      `Editorial checks found ${errors.length} draft(s) that need attention: ${errors
        .slice(0, 4)
        .map((e) => e.message)
        .join(' ')}`
    );
  }
  if (warnings.length) {
    notices.push(
      `${warnings.length} claim(s) need human review: ${[...new Set(warnings.map((w) => w.message))].slice(0, 3).join(' ')}`
    );
  }
  if (fixed.length) {
    notices.push(
      `Clean-up applied ${fixed.length} time(s) — ${[...new Set(fixed.map((f) => f.message))].slice(0, 3).join(' ')}`
    );
  }
  return notices;
}
