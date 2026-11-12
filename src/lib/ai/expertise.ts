/**
 * Field expertise for a website-design studio.
 *
 * This is the "professional training" layer: how a senior marketer actually
 * writes, prices, positions and follows up — and the rules that keep the output
 * credible instead of spammy. It is used three ways:
 *   1. as system-prompt context for the AI provider,
 *   2. as deterministic guidance when no provider is configured,
 *   3. as the teaching content shown to the operator.
 *
 * No invented statistics, testimonials, certifications or deadlines are allowed
 * anywhere in this file — the copy is composed from what the operator supplied.
 */

export const EXPERT_SYSTEM_PROMPT = `You are the senior brand and growth strategist for a small website design studio.
You have ten years of experience writing for local service businesses. You write the way a trusted consultant talks:
specific, calm, evidence-led, never hype. You are commercially sharp but honest — you would rather lose a lead than
overpromise.

Writing rules (non-negotiable):
- Never invent facts: no statistics, review counts, client names, awards, guarantees, deadlines or prices that were
  not supplied to you. If a number is missing, write around it.
- No fake urgency or scarcity ("only 2 slots left", "today only") unless the operator supplied that fact.
- No bait-and-switch hooks, no "DM me fast", no "100% guaranteed", no ALL-CAPS shouting, no emoji stacks.
- Write for a busy owner: lead with the outcome, then the mechanism, then the ask. One idea per paragraph.
- Sound like a person, not a brochure: concrete nouns, active verbs, short sentences, no corporate filler
  ("synergy", "leverage", "cutting-edge", "revolutionary", "unlock the power").
- Respect platform norms and limits. A LinkedIn post is not a tweet; a Quora answer is not an advert.
- Use the operator's real business details, CTA and language. Include contact details only when the operator has
  made them public.
- When you are unsure, say what you would need to know rather than filling the gap.

You are an assistant and you say so when asked. You do not pretend to be the business owner, and you never claim
to have performed work that was not described.`;

export const QUALITY_RULES = [
  'One clear promise per post; no second offer competing for attention.',
  'Lead with the customer outcome, not the technology.',
  'Concrete detail beats adjectives: "loads in under two seconds" beats "lightning fast".',
  'Publish a price range when the operator has one — it qualifies enquiries.',
  'One call to action per post, phrased as a next step.',
  'No unverifiable claims, no invented reviews, no fake scarcity.',
  'Match the platform: length, structure, hashtag count, image ratio.',
  'Reply-worthy: end with a question only when a real conversation is wanted.',
  'Accessibility: alt text on every image, no text baked into an unreadable crop.',
  'Humans before algorithms: the post must be useful if the platform disappeared tomorrow.',
];

export interface PlatformVoice {
  tone: string;
  hookStyle: string;
  structure: string[];
  ctaStyle: string;
  avoid: string[];
}

/** Platform-native voice. Compact, but specific enough to change the copy. */
export const PLATFORM_VOICE: Record<string, PlatformVoice> = {
  wordpress: {
    tone: 'Editorial, useful, no sales pressure. A real article someone would bookmark.',
    hookStyle: 'Open with the reader’s problem in one sentence, then promise the practical takeaway.',
    structure: ['Problem in one line', 'What we changed / what matters (H2s)', 'Concrete checklist', 'Single next step'],
    ctaStyle: 'One line at the end, framed as further reading or a conversation.',
    avoid: ['Keyword stuffing', 'An advert dressed as an article', 'Stock claims about "the digital age"'],
  },
  blogger: {
    tone: 'Friendly explainer with a personal voice, like a knowledgeable local business owner.',
    hookStyle: 'A direct answer first, then the reasoning, then an FAQ.',
    structure: ['Short answer', 'Why it matters', 'FAQ (3 real questions)', 'Next step'],
    ctaStyle: 'Soft, helpful: “if you want a starting point, here it is”.',
    avoid: ['Long unbroken paragraphs', 'Repeating the same CTA three times'],
  },
  ghost: {
    tone: 'Craft and process. Show how the work is done and why the choices were made.',
    hookStyle: 'Announce the process you are about to explain, plainly.',
    structure: ['Process steps', 'Trade-offs', 'What we would not do', 'Handover/ownership'],
    ctaStyle: 'Invite a conversation about fit, not a hard sell.',
    avoid: ['Vague “digital transformation” language', 'Pretending every project is identical'],
  },
  devto: {
    tone: 'Practitioner to practitioner. Technical, opinionated, no marketing gloss.',
    hookStyle: 'Name the failure mode other builders will recognise.',
    structure: ['Problem', 'Checklist with reasoning', 'What not to do', 'Closing aparté'],
    ctaStyle: 'Minimal; a footnote is enough.',
    avoid: ['Selling in the first paragraph', 'Buzzwords instead of measurements'],
  },
  hashnode: {
    tone: 'Engineering decision log: trade-offs, constraints, outcomes.',
    hookStyle: 'State the decision the team faced.',
    structure: ['Context', 'Options considered', 'Decision and why', 'What we would change'],
    ctaStyle: 'Invite disagreement or experience.',
    avoid: ['Listicles with no reasoning', 'Fake benchmarks'],
  },
  telegram: {
    tone: 'Personal, direct, useful. A message from a person you know, not a broadcast blast.',
    hookStyle: 'Lead with what the reader gets, in one line.',
    structure: ['One-line value', 'Two sentences of substance', 'Price if public', 'Link or WhatsApp'],
    ctaStyle: 'A single link or number, no pressure.',
    avoid: ['Forwarded-broadcast tone', 'Wall of text', 'Multiple links'],
  },
  discord: {
    tone: 'Community-native, low-ego, markdown-light. Contribute before promoting.',
    hookStyle: 'Say what you built and what problem it solved for a specific kind of business.',
    structure: ['Short intro', 'What is included', 'Price', 'Where to ask questions'],
    ctaStyle: 'Invite questions in the channel.',
    avoid: ['@everyone', 'Link dumps', 'Hard selling'],
  },
  bluesky: {
    tone: 'Conversational, curious, slightly contrarian. No hashtag spam.',
    hookStyle: 'One sharp observation, then the practical takeaway.',
    structure: ['Observation', 'Why it happens', 'What to do', 'Optional link'],
    ctaStyle: 'Question or a plain link.',
    avoid: ['Engagement bait', 'Threadboi padding', 'Hashtag walls'],
  },
  mastodon: {
    tone: 'Thoughtful, community-minded, alt-text mandatory, no growth-hack energy.',
    hookStyle: 'Start with the local-business reality, not the product.',
    structure: ['Observation', 'Practical advice', 'One link'],
    ctaStyle: 'Soft, informational.',
    avoid: ['Marketing-speak', 'Cross-posted ad copy', 'Ignoring alt text'],
  },
  tumblr: {
    tone: 'Visual-first, informal, a little wry. The image carries the post.',
    hookStyle: 'A short caption that adds context the image cannot show.',
    structure: ['Caption', 'One useful detail', 'Link'],
    ctaStyle: 'Casual.',
    avoid: ['Corporate tone', 'Hashtag stuffing'],
  },
  pinterest: {
    tone: 'Inspirational but concrete: a saved idea, not an advert.',
    hookStyle: 'Describe the outcome the pin represents.',
    structure: ['Benefit-led title', 'Two-line description', 'Keywords in natural language'],
    ctaStyle: 'Visit the site for details.',
    avoid: ['Clickbait overlays', 'Text-heavy images', 'Unrelated keywords'],
  },
  linkedin: {
    tone: 'Professional, specific, first-person. Insight over announcement.',
    hookStyle: 'A business observation the reader has felt but not articulated.',
    structure: ['Observation', 'What we do about it', 'Evidence or example', 'Question or offer'],
    ctaStyle: 'Invite a conversation, not a demo.',
    avoid: ['Broetry line breaks', 'Humble-brag', '“Agree?” bait'],
  },
  googlebusiness: {
    tone: 'Local, factual, service-first. Written for someone about to call.',
    hookStyle: 'State the service and area plainly.',
    structure: ['What we do', 'What is included', 'Price range', 'How to contact'],
    ctaStyle: 'Call or WhatsApp.',
    avoid: ['Hashtags', 'Promotional hype', 'Long paragraphs'],
  },
  x: {
    tone: 'Punchy, specific, no hashtag soup. One idea per post.',
    hookStyle: 'A concrete observation or a small numbers-driven claim you can defend.',
    structure: ['Hook', 'Substance', 'Link'],
    ctaStyle: 'Plain link or question.',
    avoid: ['Threads that should be an article', '“🚀🚀🚀”', '3+ hashtags'],
  },
  flickr: {
    tone: 'Photographer’s caption: descriptive, credits, no hard sell.',
    hookStyle: 'Describe what the image shows and why it was made.',
    structure: ['Description', 'Context', 'Link in profile'],
    ctaStyle: 'Implicit.',
    avoid: ['Sales copy', 'Irrelevant tags'],
  },
  youtube: {
    tone: 'Spoken-word rhythm, front-loaded value, no “hey guys”.',
    hookStyle: 'The first three seconds promise the outcome.',
    structure: ['Promise', 'Show the thing', 'One takeaway', 'Next step'],
    ctaStyle: 'Visit the link in the description.',
    avoid: ['Misleading thumbnails', 'A still image presented as a Short'],
  },
  slack: {
    tone: 'Internal team clarity: what changed, why, what to do.',
    hookStyle: 'State the decision or update in the first line.',
    structure: ['Update', 'Details as bullets', 'Action/owner'],
    ctaStyle: 'Ask for a reply in thread.',
    avoid: ['Marketing copy in a team channel', 'Long unformatted blobs'],
  },
  matrix: {
    tone: 'Technical community, plain language, no growth tactics.',
    hookStyle: 'What this is and who it helps.',
    structure: ['Context', 'Detail', 'Link'],
    ctaStyle: 'Invite discussion.',
    avoid: ['Promotional tone', 'Off-topic rooms'],
  },
  behance: {
    tone: 'Case study: brief, constraints, decisions, outcome. Designers read this.',
    hookStyle: 'The business problem, not the visual style.',
    structure: ['Brief', 'Approach', 'Design decisions', 'Result / credits'],
    ctaStyle: 'Contact for project enquiries.',
    avoid: ['Marketing fluff', 'Claiming metrics you cannot show'],
  },
  dribbble: {
    tone: 'Craft note: what the shot shows, what problem it solves.',
    hookStyle: 'One sentence on the design intent.',
    structure: ['Shot description', 'Problem solved', 'Tools/credits'],
    ctaStyle: 'Portfolio link.',
    avoid: ['Fake client work', 'Unexplained dribbble-bait'],
  },
  quora: {
    tone: 'Genuinely answer the question first. Disclosure if you sell the service.',
    hookStyle: 'Direct answer in the first line.',
    structure: ['Short answer', 'Reasoning with specifics', 'When the answer changes', 'Disclosure'],
    ctaStyle: 'A resource link, not a pitch.',
    avoid: ['Promoting before answering', 'Hiding your commercial interest'],
  },
  reddit: {
    tone: 'Community member, not marketer. Ask, contribute, disclose.',
    hookStyle: 'A real question or a useful observation for that subreddit.',
    structure: ['Context', 'What you have seen', 'Open question', 'Disclosure'],
    ctaStyle: 'No link unless asked; answer in comments.',
    avoid: ['Self-promotion', 'Link drops', 'Sockpuppets', 'Astroturfing'],
  },
  indiamart: {
    tone: 'Listing clarity: category, scope, price, area, contact.',
    hookStyle: 'What is being sold, for whom.',
    structure: ['Service', 'Deliverables', 'Price range', 'Service area', 'Contact'],
    ctaStyle: 'Request a quote.',
    avoid: ['Vague deliverables', 'Hidden pricing', 'Unverifiable claims'],
  },
  justdial: {
    tone: 'Local listing: plain facts a caller needs.',
    hookStyle: 'Service and area.',
    structure: ['Category', 'Included', 'Price', 'Area', 'Contact'],
    ctaStyle: 'Call.',
    avoid: ['Hashtags', 'Marketing copy'],
  },
  goodfirms: {
    tone: 'Firm profile: capability, engagement model, focus, proof you can substantiate.',
    hookStyle: 'Who you help and how.',
    structure: ['Profile', 'Services', 'Engagement model', 'Focus', 'Contact'],
    ctaStyle: 'Contact for proposal.',
    avoid: ['Invented client logos', 'Unverifiable awards'],
  },
};

export const OBJECTION_HANDLING = [
  {
    objection: '“I already have Instagram, why a website?”',
    answer:
      'Instagram rents you an audience; a website is an asset you own. The page answers price and service questions once, so every enquiry starts warmer — and it is the only place where your full offer can be found by search.',
  },
  {
    objection: '“₹2,999 seems too cheap — is it real?”',
    answer:
      'It is a focused one-page build: design, mobile layout, enquiry buttons, basic SEO, handover. Anything beyond that scope is quoted separately. Publishing the scope is what makes the low price credible.',
  },
  {
    objection: '“My nephew built me a page.”',
    answer:
      'Keep it if it loads fast and makes contacting you easy. If it fails either test, that is the conversation — not a redesign for its own sake.',
  },
  {
    objection: '“I do not have photos or content.”',
    answer:
      'Use three real phone photos of the work and the details you already tell customers on a call. We write the copy from that; stock photography usually hurts local trust.',
  },
  {
    objection: '“Will I get customers immediately?”',
    answer:
      'No honest answer promises that. A site removes friction for people already looking; ads and local listings create the looking.',
  },
];

export const OUTREACH_ETHICS = [
  'Only email businesses you can name a reason for contacting (they enquired, you met, they are listed publicly as open to suppliers).',
  'No purchased lists. No scraped addresses. No re-mailing someone who opted out.',
  'One follow-up maximum unless they reply. Then stop.',
  'Identify the sender, the business, and how you got the address.',
  'Make opting out a single word and honour it permanently.',
  'No false “re:” subjects, no spoofed display names, no fake invoices.',
];

/** Compact context injected into generation prompts. */
export function expertBrief(platformIds: string[]): string {
  const voices = platformIds
    .map((id) => PLATFORM_VOICE[id])
    .filter(Boolean)
    .slice(0, 12)
    .map((v) => `- ${v.tone} Hook: ${v.hookStyle} Avoid: ${v.avoid.join(', ')}.`);
  return `${EXPERT_SYSTEM_PROMPT}\n\nPlatform voice notes:\n${voices.join('\n')}`;
}
