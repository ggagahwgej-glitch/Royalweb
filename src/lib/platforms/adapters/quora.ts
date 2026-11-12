import { manualAdapter } from './_manual';

export const quora = manualAdapter({
  id: 'quora',
  name: 'Quora',
  integration: 'Manual / assisted publishing',
  docsUrl: 'https://www.quora.com/',
  notes:
    'Quora has no publishing API. ROYALWEB drafts genuinely helpful answers, matching question ideas and topic suggestions. Spam or repeated self-promotion violates Quora policy — this adapter is for real answers only.',
  connectInstructions: 'Save your Quora profile URL. Post answers yourself from the prepared drafts.',
  permissionNotes: 'Your own Quora account. Disclose your business relationship when you mention your services.',
  manualUrl: 'https://www.quora.com/',
  contentHint:
    'A helpful, educational Quora answer (250-450 words) to a realistic question a local business owner would ask about websites. Give practical advice first, mention the business only briefly at the end as the author. Include 2-3 follow-up question ideas and 3-5 relevant topics.',
  limits: { caption: 12000, title: 200, hashtags: 5 },
  capabilities: { text: true, image: false, article: true },
});
