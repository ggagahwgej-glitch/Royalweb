import 'server-only';
import type { PlatformAdapter, PlatformId } from './types';
import { wordpress } from './adapters/wordpress';
import { blogger } from './adapters/blogger';
import { telegram } from './adapters/telegram';
import { discord } from './adapters/discord';
import { bluesky } from './adapters/bluesky';
import { mastodon } from './adapters/mastodon';
import { tumblr } from './adapters/tumblr';
import { devto } from './adapters/devto';
import { hashnode } from './adapters/hashnode';
import { ghost } from './adapters/ghost';
import { pinterest } from './adapters/pinterest';
import { linkedin } from './adapters/linkedin';
import { googlebusiness } from './adapters/googlebusiness';
import { x } from './adapters/x';
import { flickr } from './adapters/flickr';
import { youtube } from './adapters/youtube';
import { slack } from './adapters/slack';
import { matrix } from './adapters/matrix';
import { behance } from './adapters/behance';
import { dribbble } from './adapters/dribbble';
import { quora } from './adapters/quora';
import { reddit } from './adapters/reddit';
import { indiamart } from './adapters/indiamart';
import { justdial } from './adapters/justdial';
import { goodfirms } from './adapters/goodfirms';

/** The 25 supported platforms, in the order they are presented in the dashboard. */
export const ADAPTERS: PlatformAdapter[] = [
  wordpress,
  blogger,
  telegram,
  discord,
  bluesky,
  mastodon,
  tumblr,
  devto,
  hashnode,
  ghost,
  pinterest,
  linkedin,
  googlebusiness,
  x,
  flickr,
  youtube,
  slack,
  matrix,
  behance,
  dribbble,
  quora,
  reddit,
  indiamart,
  justdial,
  goodfirms,
];

export const ADAPTER_MAP: Record<string, PlatformAdapter> = Object.fromEntries(
  ADAPTERS.map((a) => [a.id, a])
) as Record<PlatformId, PlatformAdapter>;

export function getAdapter(id: string): PlatformAdapter | undefined {
  return ADAPTER_MAP[id];
}

export function platformNumber(id: string): number {
  return ADAPTERS.findIndex((a) => a.id === id) + 1;
}

export const GROUP_LABEL: Record<string, string> = {
  A: 'Group A · Automatic publishing candidates',
  B: 'Group B · Official API / approval-dependent',
  C: 'Group C · Manual / assisted publishing',
};

export const AUTOMATION_LABEL: Record<string, string> = {
  automatic: 'Automatic publish',
  approval: 'Approval required',
  manual: 'Manual publishing',
};

export type { PlatformAdapter };
export type { PlatformId };
export * from './types';
