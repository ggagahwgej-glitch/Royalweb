import { manualAdapter } from './_manual';

export const goodfirms = manualAdapter({
  id: 'goodfirms',
  name: 'GoodFirms',
  integration: 'Manual / assisted publishing',
  docsUrl: 'https://www.goodfirms.co/',
  notes:
    'GoodFirms does not provide a public publishing API. ROYALWEB prepares the agency profile description, service list, portfolio descriptions and project showcase text for manual submission or profile updates.',
  connectInstructions: 'Save your GoodFirms profile URL. Copy the prepared agency profile content into your dashboard.',
  permissionNotes: 'Your own verified agency profile. Do not create duplicate or fake company profiles.',
  manualUrl: 'https://www.goodfirms.co/',
  contentHint:
    'GoodFirms agency profile content: a 150-250 word company overview, 3-5 service descriptions with deliverables, a portfolio project summary, industries served, engagement model and a contact CTA. Professional B2B tone, no fabricated awards or client names.',
  limits: { caption: 4000, title: 120, hashtags: 10 },
  capabilities: { text: true, image: true, article: true },
});
