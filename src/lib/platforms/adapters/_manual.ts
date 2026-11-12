import type { PlatformAdapter, PlatformGroup } from '../types';

/**
 * Factory for assisted-publishing platforms (Group C).
 *
 * These platforms have no supported public publishing API for this use case.
 * The adapter never automates a browser and never claims a post happened —
 * it produces a complete, copy-ready package and the user marks it published
 * manually in the Manual Publishing Center.
 */
export function manualAdapter(config: {
  id: PlatformAdapter['id'];
  name: string;
  integration: string;
  docsUrl: string;
  notes: string;
  connectInstructions: string;
  permissionNotes: string;
  manualUrl: string;
  contentHint: string;
  limits: PlatformAdapter['limits'];
  credentialFields?: PlatformAdapter['credentialFields'];
  capabilities?: Partial<PlatformAdapter['capabilities']>;
  group?: PlatformGroup;
}): PlatformAdapter {
  return {
    id: config.id,
    name: config.name,
    group: config.group ?? 'C',
    automation: 'manual',
    integration: config.integration,
    docsUrl: config.docsUrl,
    notes: config.notes,
    connectInstructions: config.connectInstructions,
    permissionNotes: config.permissionNotes,
    manualUrl: config.manualUrl,
    credentialFields: config.credentialFields ?? [
      {
        key: 'profileUrl',
        label: 'Your profile URL (optional)',
        type: 'url',
        required: false,
        help: 'Saved for your reference so the manual queue opens the right place.',
      },
    ],
    capabilities: {
      text: true,
      image: true,
      video: false,
      article: false,
      ...config.capabilities,
    },
    async verify({ credentials }) {
      // No API call is made for manual platforms. If a profile URL is supplied,
      // validate that it is a well-formed URL for the right domain.
      if (credentials.profileUrl) {
        try {
          const u = new URL(credentials.profileUrl);
          return {
            ok: true,
            accountName: credentials.profileUrl.replace(/^https?:\/\//, ''),
            meta: { profileUrl: credentials.profileUrl, host: u.host },
          };
        } catch {
          return { ok: false, detail: 'That profile URL is not valid.' };
        }
      }
      return { ok: true, accountName: 'Manual publishing', meta: { mode: 'manual' } };
    },
    async publish() {
      return {
        ok: false,
        requiresManual: true,
        error:
          'This platform has no supported automatic publishing API for this workflow. The content package is queued in the Manual Publishing Center.',
        errorCode: 'manual_publish_required',
        retryable: false,
      };
    },
    contentHint: config.contentHint,
    limits: config.limits,
  };
}
