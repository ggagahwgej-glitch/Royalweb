import { manualAdapter } from './_manual';

export const behance = manualAdapter({
  id: 'behance',
  name: 'Behance',
  integration: 'Manual / assisted publishing',
  docsUrl: 'https://www.behance.net/',
  notes:
    'Behance has no public publishing API. ROYALWEB prepares the complete project (title, description, images, portfolio write-up, links) for you to upload yourself.',
  connectInstructions: 'Add your Behance profile or portfolio URL for reference, then publish projects from the Manual Publishing Center.',
  permissionNotes: 'Your own Behance account. No automation, no credentials required.',
  manualUrl: 'https://www.behance.net/',
  contentHint:
    'Portfolio project presentation for a web design studio: a project title, 120-200 word case-study description (goal, what was built, result), tools/tech list, and a closing invitation. Professional, process-oriented, no pricing.',
  limits: { caption: 5000, title: 120, hashtags: 15 },
  capabilities: { text: true, image: true, article: true },
});
