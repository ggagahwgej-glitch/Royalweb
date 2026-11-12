import { handler, jsonOk } from '@/lib/api';
import { all } from '@/lib/db';
import { ADAPTERS, ADAPTER_MAP } from '@/lib/platforms';
import { platformOut } from '@/lib/serialize';
import { quickConnectFor, quickTier, TIER_LABEL } from '@/lib/platforms/quick-connect';
import { getSecret } from '@/lib/secrets';
import { ffmpegPath } from '@/lib/media/video';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const rows = all<Record<string, unknown>>(
    `SELECT p.*,
       (SELECT COUNT(*) FROM connected_accounts a WHERE a.platform_id = p.id AND a.status = 'connected') AS account_count,
       (SELECT COUNT(*) FROM publishing_jobs j WHERE j.platform_id = p.id AND j.status = 'published') AS published_count,
       (SELECT COUNT(*) FROM publishing_jobs j WHERE j.platform_id = p.id AND j.status IN ('failed','connection_expired')) AS failed_count,
       (SELECT COUNT(*) FROM publishing_jobs j WHERE j.platform_id = p.id AND j.status = 'scheduled') AS scheduled_count
     FROM platforms p ORDER BY p.sort_order`
  );
  const renderer = Boolean(await ffmpegPath());

  const platforms = rows.map((row) => {
    const adapter = ADAPTER_MAP[String(row.id)];
    const out = platformOut(row);
    const oauthRequired = Boolean(adapter?.oauth);
    const oauthKeyMap: Record<string, string> = {
      google: 'oauth.google.clientId',
      pinterest: 'oauth.pinterest.clientId',
      linkedin: 'oauth.linkedin.clientId',
      x: 'oauth.x.clientId',
      slack: 'oauth.slack.clientId',
      tumblr: 'oauth.tumblr.clientId',
    };
    const oauthConfigured = adapter?.oauth ? Boolean(getSecret(oauthKeyMap[adapter.oauth.provider])) : false;
    return {
      ...out,
      group: adapter?.group ?? out.group,
      number: ADAPTERS.findIndex((a) => a.id === row.id) + 1,
      capabilities: adapter?.capabilities ?? { text: true, image: true, video: false, article: false },
      limits: adapter?.limits ?? { caption: 2000 },
      connectInstructions: adapter?.connectInstructions ?? '',
      permissionNotes: adapter?.permissionNotes ?? '',
      automationLabel:
        out.automation === 'automatic'
          ? 'Automatic publishing'
          : out.automation === 'approval'
            ? 'Official API — approval required'
            : 'Manual / assisted publishing',
      oauthRequired,
      oauthConfigured,
      // Quick-connect wizard metadata: where to get the key, what to click, and
      // which bucket the platform sits in. Derived from the adapter so the wizard
      // can never claim a platform is "quick" when it needs approval.
      quickConnect: quickConnectFor(String(row.id)),
      tier: adapter ? quickTier(adapter) : 'manual',
      tierLabel: TIER_LABEL[adapter ? quickTier(adapter) : 'manual'],
      manualUrl: adapter?.manualUrl ?? null,
      credentialFields: adapter?.credentialFields ?? [],
      rendererAvailable: adapter?.capabilities.video ? renderer : null,
      status:
        out.automation === 'manual'
          ? out.accountCount > 0
            ? 'ready'
            : 'manual'
          : out.accountCount > 0
            ? out.lastError
              ? 'error'
              : 'connected'
            : oauthRequired && !oauthConfigured
              ? 'needs_configuration'
              : 'not_connected',
    };
  });

  return jsonOk({ platforms, total: platforms.length, videoRenderer: renderer });
});
