import { manualAdapter } from './_manual';

export const dribbble = manualAdapter({
  id: 'dribbble',
  name: 'Dribbble',
  integration: 'Manual / assisted publishing',
  docsUrl: 'https://dribbble.com/',
  notes:
    'Dribbble’s API does not allow general shot publishing with a standard developer account. ROYALWEB prepares a 4:3 shot image, title, description, tags and destination link for manual upload.',
  connectInstructions: 'Save your Dribbble profile URL for reference. Shots are uploaded manually from the prepared package.',
  permissionNotes: 'Your own Dribbble account. Publishing requires a manual upload.',
  manualUrl: 'https://dribbble.com/shots/new',
  contentHint:
    'Dribbble shot details: a short punchy title (max 60 chars), a 1-2 sentence description of the design decision shown in the shot, 5-8 kebab-case tags, and the live site link. Designer voice.',
  limits: { caption: 600, title: 60, hashtags: 8 },
  capabilities: { text: true, image: true },
});
