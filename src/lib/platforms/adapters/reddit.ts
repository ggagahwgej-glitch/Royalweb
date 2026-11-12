import { manualAdapter } from './_manual';

export const reddit = manualAdapter({
  id: 'reddit',
  name: 'Reddit',
  integration: 'Manual / assisted publishing',
  docsUrl: 'https://www.reddit.com/dev/api/',
  notes:
    'Reddit’s API requires a registered app, an OAuth flow and strict adherence to subreddit rules, and self-promotion is limited by Reddit policy. ROYALWEB does not auto-post; it prepares community-appropriate drafts, subreddit research suggestions and titles for you to publish yourself.',
  connectInstructions: 'Save your Reddit profile URL. Review each subreddit’s rules before posting any draft.',
  permissionNotes: 'Posting requires your own account and manual review. Respect each subreddit’s self-promotion rules and Reddit’s content policy.',
  manualUrl: 'https://www.reddit.com/submit',
  contentHint:
    'A non-promotional discussion draft suitable for a local-business or webdev subreddit: honest title (max 300 chars), a question or insight body that invites discussion, no links in the body, and a note on how to disclose the business. Also produce 3 subreddit suggestions with why they fit and what their rules usually require.',
  limits: { caption: 8000, title: 300, hashtags: 0 },
  capabilities: { text: true, image: true },
});
