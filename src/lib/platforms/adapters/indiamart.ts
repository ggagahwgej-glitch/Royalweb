import { manualAdapter } from './_manual';

export const indiamart = manualAdapter({
  id: 'indiamart',
  name: 'IndiaMART',
  integration: 'Manual / seller-panel publishing',
  docsUrl: 'https://seller.indiamart.com/',
  notes:
    'IndiaMART does not offer a public posting API for this use case; listings are managed in the seller panel. ROYALWEB prepares the business profile, service descriptions, listing copy, images and enquiry details for manual entry.',
  connectInstructions: 'Save your IndiaMART seller profile URL. Copy the prepared listing content into the seller panel.',
  permissionNotes: 'Your verified seller account only. Never create fake business listings.',
  manualUrl: 'https://seller.indiamart.com/',
  contentHint:
    'IndiaMART listing package: business introduction (80-120 words), a service listing title, a service description with deliverables and turnaround, price range, service area, enquiry call-to-action and contact placeholders. Commercial and factual, no exaggerated claims.',
  limits: { caption: 3000, title: 100, hashtags: 10 },
  capabilities: { text: true, image: true },
});
