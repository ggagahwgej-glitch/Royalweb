import { manualAdapter } from './_manual';

export const justdial = manualAdapter({
  id: 'justdial',
  name: 'Justdial',
  integration: 'Manual / listing panel publishing',
  docsUrl: 'https://www.justdial.com/',
  notes:
    'Justdial listings are managed through its business panel; there is no supported public publishing API. ROYALWEB prepares the listing text, business introduction, graphics and contact details for manual submission.',
  connectInstructions: 'Save your Justdial listing URL. Submit the prepared content through the Justdial business panel.',
  permissionNotes: 'Only the verified owner of the listed business should update it.',
  manualUrl: 'https://www.justdial.com/',
  contentHint:
    'Justdial listing content: a concise business introduction (60-100 words), service category description, key highlights as short bullets, service area, working hours placeholder and contact details. Factual, locally relevant.',
  limits: { caption: 2000, title: 100, hashtags: 5 },
  capabilities: { text: true, image: true },
});
