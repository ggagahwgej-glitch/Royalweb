export type PlatformId =
  | 'wordpress'
  | 'blogger'
  | 'telegram'
  | 'discord'
  | 'bluesky'
  | 'mastodon'
  | 'tumblr'
  | 'devto'
  | 'hashnode'
  | 'ghost'
  | 'pinterest'
  | 'linkedin'
  | 'googlebusiness'
  | 'x'
  | 'flickr'
  | 'youtube'
  | 'slack'
  | 'matrix'
  | 'behance'
  | 'dribbble'
  | 'quora'
  | 'reddit'
  | 'indiamart'
  | 'justdial'
  | 'goodfirms';

export type PlatformGroup = 'A' | 'B' | 'C';
/** automatic = API publish; approval = API exists but access must be granted; manual = assisted package */
export type Automation = 'automatic' | 'approval' | 'manual';

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface AdapterMedia {
  id: string;
  filename: string;
  mime: string;
  kind: 'image' | 'video';
  width?: number | null;
  height?: number | null;
  buffer: Buffer;
  altText: string;
  /** Signed, publicly reachable URL (only when PUBLIC_BASE_URL is configured). */
  publicUrl?: string;
}

export interface AdapterContent {
  title: string;
  caption: string;
  description: string;
  hashtags: string[];
  cta: string;
  destinationUrl: string;
  altText: string;
  extra: Record<string, unknown>;
}

export interface BusinessProfile {
  businessName: string;
  tagline: string;
  websiteUrl: string;
  whatsappUrl: string;
  contactEmail: string;
  contactPhone: string;
  publicContactVisible: boolean;
  services: string[];
  targetCustomers: string[];
  priceMin: string;
  priceMax: string;
  ctaPrimary: string;
  ctaSecondary: string;
}

export interface PublishInput {
  account: {
    id: string;
    accountName: string;
    credentials: Record<string, string>;
    meta: Record<string, unknown>;
  };
  content: AdapterContent;
  media: AdapterMedia[];
  campaign: { id: string; name: string; offerPrice?: string };
  business: BusinessProfile;
  idempotencyKey: string;
  log: (step: string, message: string, meta?: Record<string, unknown>) => void;
}

export interface PublishResult {
  ok: boolean;
  externalId?: string;
  url?: string;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
  requiresManual?: boolean;
  meta?: Record<string, unknown>;
}

export interface VerifyResult {
  ok: boolean;
  accountName?: string;
  externalId?: string;
  detail?: string;
  scopes?: string;
  expiresAt?: string;
  meta?: Record<string, unknown>;
}

export interface VerifyInput {
  credentials: Record<string, string>;
  meta: Record<string, unknown>;
}

export type OAuthProvider = 'google' | 'pinterest' | 'linkedin' | 'x' | 'slack' | 'tumblr';

export interface PlatformAdapter {
  id: PlatformId;
  name: string;
  group: PlatformGroup;
  automation: Automation;
  integration: string;
  docsUrl: string;
  /** Honest, user-facing notes about requirements, limits, approvals. */
  notes: string;
  connectInstructions: string;
  permissionNotes: string;
  credentialFields: CredentialField[];
  capabilities: {
    text: boolean;
    image: boolean;
    video: boolean;
    article: boolean;
    /** Images require a publicly reachable URL rather than a direct upload. */
    imageViaUrl?: boolean;
  };
  oauth?: { provider: OAuthProvider; scopes: string[] };
  verify(input: VerifyInput): Promise<VerifyResult>;
  publish(input: PublishInput): Promise<PublishResult>;
  contentHint: string;
  limits: { caption: number; title?: number; hashtags?: number };
  /** Peers shown in the manual center so users know where to go. */
  manualUrl?: string;
}
