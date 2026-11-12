/**
 * Quick-connect metadata: where to get each credential, and one line telling you
 * exactly what to click once you are there.
 *
 * Kept in one table (rather than sprinkled through the adapters) so the wizard,
 * the docs and the tests all read the same links. The tier is *not* stored here:
 * it is derived from the adapter (oauth present / approval / manual) so the
 * wizard can never disagree with the publishing engine about what is possible.
 */
import type { PlatformId } from './types';

export type QuickTier = 'quick' | 'oauth' | 'manual';

export interface QuickConnectEntry {
  /** Deep link to the exact portal / token page. Always https. */
  keyUrl: string;
  /** What the button says, e.g. "Open BotFather". */
  keyLabel: string;
  /** One line of instruction. No essays. */
  micro: string;
  /** Rough minutes for a first-time setup, shown as a badge. */
  minutes: number;
}

export const QUICK_CONNECT: Record<PlatformId, QuickConnectEntry> = {
  wordpress: {
    keyUrl: 'https://wordpress.org/documentation/article/application-passwords/',
    keyLabel: 'Open WordPress guide',
    micro: 'In your site: Users → Profile → Application Passwords → name it “royalweb” → Copy Password.',
    minutes: 2,
  },
  telegram: {
    keyUrl: 'https://t.me/BotFather',
    keyLabel: 'Open BotFather',
    micro: 'Send /newbot → name it → copy the HTTP API token, then add the bot to your channel as admin.',
    minutes: 2,
  },
  discord: {
    keyUrl: 'https://discord.com/developers/applications',
    keyLabel: 'Open Discord Developers',
    micro: 'New Application → Bot → Reset Token → Copy, then invite the bot to your server.',
    minutes: 3,
  },
  bluesky: {
    keyUrl: 'https://bsky.app/settings/app-passwords',
    keyLabel: 'Open App Passwords',
    micro: 'App Passwords → Add App Password → copy the xxxx-xxxx-xxxx-xxxx value (not your login password).',
    minutes: 2,
  },
  mastodon: {
    keyUrl: 'https://mastodon.social/settings/applications',
    keyLabel: 'Open Mastodon apps',
    micro: 'Preferences → Development → New application → tick write:statuses → copy the access token (use your own instance URL).',
    minutes: 3,
  },
  devto: {
    keyUrl: 'https://dev.to/settings/extensions',
    keyLabel: 'Open DEV settings',
    micro: 'Settings → Extensions → DEV Community API Keys → Generate API Key → copy it.',
    minutes: 2,
  },
  hashnode: {
    keyUrl: 'https://hashnode.com/settings/developer',
    keyLabel: 'Open Hashnode developer settings',
    micro: 'Developer settings → Generate new token → copy it, and grab your publication host (e.g. blog.hashnode.dev).',
    minutes: 2,
  },
  ghost: {
    keyUrl: 'https://ghost.org/integrations/custom-integrations/',
    keyLabel: 'Open Ghost integrations',
    micro: 'Ghost Admin → Settings → Integrations → Add custom integration → copy the Admin API key (id:secret).',
    minutes: 3,
  },
  matrix: {
    keyUrl: 'https://app.element.io/#/user-settings',
    keyLabel: 'Open Element settings',
    micro: 'Settings → Help & About → Advanced → Access Token → copy it, plus the room ID to post into.',
    minutes: 3,
  },
  blogger: {
    keyUrl: 'https://console.cloud.google.com/apis/credentials',
    keyLabel: 'Open Google Cloud credentials',
    micro: 'Create OAuth client (Web application) → add the redirect URI from Settings → Integrations → paste Client ID/Secret there.',
    minutes: 8,
  },
  youtube: {
    keyUrl: 'https://console.cloud.google.com/apis/credentials',
    keyLabel: 'Open Google Cloud credentials',
    micro: 'Enable YouTube Data API v3 → OAuth client → paste Client ID/Secret in Settings → Integrations, then Connect.',
    minutes: 10,
  },
  googlebusiness: {
    keyUrl: 'https://console.cloud.google.com/apis/credentials',
    keyLabel: 'Open Google Cloud credentials',
    micro: 'Enable Business Profile API, request access, then create an OAuth client and paste it in Settings → Integrations.',
    minutes: 15,
  },
  pinterest: {
    keyUrl: 'https://developers.pinterest.com/apps/',
    keyLabel: 'Open Pinterest apps',
    micro: 'Create app → Standard access → copy App ID and secret into Settings → Integrations, then Connect.',
    minutes: 10,
  },
  linkedin: {
    keyUrl: 'https://www.linkedin.com/developers/apps',
    keyLabel: 'Open LinkedIn developers',
    micro: 'Create app → verify with your company page → request “Share on LinkedIn” → copy Client ID/Secret.',
    minutes: 12,
  },
  x: {
    keyUrl: 'https://developer.x.com/en/portal/dashboard',
    keyLabel: 'Open X developer portal',
    micro: 'Create app → Keys and tokens → copy OAuth 2.0 Client ID/Secret; write access needs a paid tier.',
    minutes: 12,
  },
  slack: {
    keyUrl: 'https://api.slack.com/apps',
    keyLabel: 'Open Slack apps',
    micro: 'Create app → OAuth & Permissions → add chat:write → copy the Bot User OAuth token and the channel ID.',
    minutes: 6,
  },
  tumblr: {
    keyUrl: 'https://www.tumblr.com/oauth/apps',
    keyLabel: 'Open Tumblr apps',
    micro: 'Register application → copy the Consumer Key/Secret into Settings → Integrations, then Connect.',
    minutes: 8,
  },
  flickr: {
    keyUrl: 'https://www.flickr.com/services/apps/create/',
    keyLabel: 'Open Flickr apps',
    micro: 'Request a non-commercial API key → copy Key and Secret into Settings → Integrations, then Connect.',
    minutes: 10,
  },
  behance: {
    keyUrl: 'https://www.behance.net/settings',
    keyLabel: 'Open Behance settings',
    micro: 'No publishing API — paste your public profile URL; ROYALWEB prepares the project copy for you to post.',
    minutes: 1,
  },
  dribbble: {
    keyUrl: 'https://dribbble.com/account/applications',
    keyLabel: 'Open Dribbble applications',
    micro: 'No public posting API — paste your profile URL and ROYALWEB prepares shot copy and tags.',
    minutes: 1,
  },
  quora: {
    keyUrl: 'https://www.quora.com/',
    keyLabel: 'Open Quora',
    micro: 'No API — paste your profile URL; answers are drafted for you to post yourself.',
    minutes: 1,
  },
  reddit: {
    keyUrl: 'https://www.reddit.com/prefs/apps',
    keyLabel: 'Open Reddit apps',
    micro: 'Create app (script) → copy client ID/secret and your username/password, and the subreddit to post in.',
    minutes: 6,
  },
  indiamart: {
    keyUrl: 'https://seller.indiamart.com/',
    keyLabel: 'Open IndiaMART seller panel',
    micro: 'No listing API for this workflow — paste your seller profile URL; the listing copy is prepared for you.',
    minutes: 1,
  },
  justdial: {
    keyUrl: 'https://www.justdial.com/Free-Listing',
    keyLabel: 'Open Justdial listing',
    micro: 'No API — paste your listing URL; ROYALWEB prepares the business description and offers.',
    minutes: 1,
  },
  goodfirms: {
    keyUrl: 'https://www.goodfirms.co/community/vendor',
    keyLabel: 'Open GoodFirms vendor portal',
    micro: 'No API — paste your vendor profile URL; reviews and service copy are prepared for you.',
    minutes: 1,
  },
};

/** The five things that make the system publish something real today. */
export const QUICK_START: PlatformId[] = ['telegram', 'wordpress', 'bluesky', 'discord', 'mastodon'];

export function quickConnectFor(id: string): QuickConnectEntry | null {
  return (QUICK_CONNECT as Record<string, QuickConnectEntry>)[id] ?? null;
}

/**
 * Which bucket the platform belongs to in the wizard. Derived from the adapter so
 * "fastest to connect" can only contain platforms that really verify without an
 * approval process.
 */
export function quickTier(adapter: { oauth?: unknown; automation: string }): QuickTier {
  if (adapter.automation === 'manual') return 'manual';
  if (adapter.oauth) return 'oauth';
  return 'quick';
}

export const TIER_LABEL: Record<QuickTier, string> = {
  quick: 'Fastest to connect (under 5 minutes)',
  oauth: 'OAuth app or approval required',
  manual: 'Manual — no key needed',
};
