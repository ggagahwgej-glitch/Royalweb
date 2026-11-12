import { handler, jsonOk, parseBody } from '@/lib/api';
import { all, get, newId, nowIso, run } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { resolveProvider } from '@/lib/ai/providers';
import { nextMorningSlot, formatInZone } from '@/lib/time';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ message: z.string().trim().min(1).max(2000) });

interface PlanItem {
  platformId: string;
  platformName: string;
  automation: string;
  connection: 'connected' | 'not_connected' | 'manual';
  willPublishAutomatically: boolean;
  contentStatus: string | null;
  note: string;
}

/**
 * ROYALWEB AI ASSISTANT.
 *
 * It prepares plans and content, but it never publishes and never claims a
 * post went live. Any plan must be approved in the campaign screen, which is
 * the only code path that can create publishing jobs.
 */
export const POST = handler(async (req, _ctx, auth) => {
  const { message } = await parseBody(req, schema);
  const settings = getSettings(auth.user.id);
  const lower = message.toLowerCase();

  const platforms = all<{
    id: string;
    name: string;
    automation: string;
    grp: string;
    enabled: number;
    accounts: number;
  }>(
    `SELECT p.id, p.name, p.automation, p.grp, p.enabled,
       (SELECT COUNT(*) FROM connected_accounts a WHERE a.platform_id = p.id AND a.user_id = ? AND a.status = 'connected') AS accounts
     FROM platforms p ORDER BY p.sort_order`,
    auth.user.id
  );

  const campaign = get<{
    id: string;
    name: string;
    status: string;
    media_count: number;
  }>(
    `SELECT c.id, c.name, c.status,
       (SELECT COUNT(*) FROM media_assets m WHERE m.campaign_id = c.id AND m.deleted_at IS NULL) AS media_count
     FROM campaigns c WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 1`,
    auth.user.id
  );

  const contents = campaign
    ? all<{ platform_id: string; status: string }>(
        'SELECT platform_id, status FROM generated_contents WHERE campaign_id = ?',
        campaign.id
      )
    : [];

  const planPlatforms = platforms;
  const items: PlanItem[] = planPlatforms.map((p) => {
    const connection: PlanItem['connection'] =
      p.automation === 'manual' ? 'manual' : p.accounts > 0 ? 'connected' : 'not_connected';
    const contentStatus = contents.find((c) => c.platform_id === p.id)?.status ?? null;
    return {
      platformId: p.id,
      platformName: p.name,
      automation: p.automation,
      connection,
      willPublishAutomatically: p.automation !== 'manual' && p.accounts > 0,
      contentStatus,
      note:
        p.automation === 'manual'
          ? 'Manual package — ROYALWEB prepares the caption and image for you to publish.'
          : p.accounts > 0
            ? 'Will publish through the official API.'
            : 'No connected account yet — connect one, or use the manual package.',
    };
  });

  const connected = items.filter((i) => i.connection === 'connected');
  const notConnected = items.filter((i) => i.connection === 'not_connected');
  const manual = items.filter((i) => i.connection === 'manual');
  const suggestedTime = nextMorningSlot(settings.defaultTimezone);

  let intent: 'plan' | 'pause' | 'status' | 'help' = 'help';
  if (/(pause|stop|halt)/.test(lower)) intent = 'pause';
  else if (/(status|what happened|failed|error|result)/.test(lower)) intent = 'status';
  else if (/(upload|poster|schedule|plan|publish|tomorrow|today|all platforms|campaign)/.test(lower)) intent = 'plan';

  const failedJobs = all<{ platform: string; error: string }>(
    `SELECT p.name AS platform, j.error FROM publishing_jobs j
       JOIN campaigns c ON c.id = j.campaign_id JOIN platforms p ON p.id = j.platform_id
      WHERE c.user_id = ? AND j.status IN ('failed','connection_expired') AND j.error IS NOT NULL
      ORDER BY j.updated_at DESC LIMIT 5`,
    auth.user.id
  );

  let reply: string;
  if (intent === 'pause') {
    reply = `Publishing can be paused globally or per campaign.\n\n• Global pause stops the worker from publishing anything: Settings → Publishing. (Current state: ${settings.globalPause ? 'paused' : 'active'}.)\n• Per campaign: open the campaign and press Pause.\n\nI will not pause anything without you confirming it. Use the button below if you want the global pause switched on.`;
  } else if (intent === 'status') {
    const total = get<{ c: number }>('SELECT COUNT(*) AS c FROM campaigns WHERE user_id = ?', auth.user.id)?.c ?? 0;
    reply = [
      `Here is the current picture from the database:`,
      `• Campaigns: ${total}`,
      `• Connected platforms: ${connected.length} of ${items.length}`,
      `• Awaiting manual publishing: ${manual.length} platform(s) supported`,
      failedJobs.length
        ? `\nRecent publishing errors:\n${failedJobs.map((f) => `• ${f.platform}: ${f.error?.slice(0, 160)}`).join('\n')}`
        : '\nNo publishing failures are recorded.',
      `\nI only report what the database confirms — nothing is marked published until the platform returns an ID or URL.`,
    ].join('\n');
  } else if (intent === 'plan') {
    reply = [
      campaign
        ? `I found your latest campaign: “${campaign.name}” (${campaign.status}), with ${campaign.media_count} media file(s).`
        : 'There is no campaign yet. Create one and upload a poster first — then I can prepare the distribution plan.',
      '',
      `Plan if you approve it now (${formatInZone(suggestedTime, settings.defaultTimezone)} ${settings.defaultTimezone}):`,
      `• ${connected.length} platform(s) can publish automatically: ${connected.map((c) => c.platformName).join(', ') || 'none'}`,
      `• ${manual.length} platform(s) need manual publishing — I will prepare copy and sized images`,
      `• ${notConnected.length} platform(s) still need an account: ${notConnected.map((c) => c.platformName).join(', ')}`,
      '',
      'Nothing has been published. Approve the content in the campaign screen to create the jobs.',
    ].join('\n');
  } else {
    reply = `I can analyse posters, draft platform-specific captions, choose platforms, prepare schedules and explain publishing errors.\n\nRight now: ${connected.length} connected platform(s), ${manual.length} manual platform(s), ${notConnected.length} awaiting a connection.${campaign ? ` Latest campaign: “${campaign.name}”.` : ' No campaign yet.'}\n\nTry: “Plan a campaign for my restaurant website offer tomorrow at 10am” or “Why did my LinkedIn post fail?”`;
  }

  // If an AI provider is configured, let it enrich the explanation — but the
  // deterministic plan above remains the source of truth.
  const provider = resolveProvider(settings.aiProvider, settings.aiModel);
  let aiUsed = false;
  let aiError: string | null = null;
  if (provider) {
    try {
      const res = await provider.chat(
        [
          {
            role: 'system',
            content:
              'You are ROYALWEB AI ASSISTANT inside a marketing automation dashboard. Be concise and concrete. Never claim a post was published: publishing only happens after the admin approves a campaign. Use the supplied plan data. Do not invent statistics.',
          },
          {
            role: 'user',
            content: `Admin message: ${message}\n\nDeterministic plan data (source of truth):\n${JSON.stringify(
              {
                intent,
                campaign: campaign ? { name: campaign.name, status: campaign.status, media: campaign.media_count } : null,
                connected: connected.map((c) => c.platformName),
                notConnected: notConnected.map((c) => c.platformName),
                manual: manual.map((c) => c.platformName),
                suggestedTime,
                timezone: settings.defaultTimezone,
                failedJobs,
                globalPause: settings.globalPause,
              },
              null,
              2
            )}\n\nWrite a helpful reply for the admin in their language. Keep the plan facts exactly as given.`,
          },
        ],
        { maxTokens: 700, temperature: 0.5 }
      );
      reply = res.text.trim() || reply;
      aiUsed = true;
      run(
        'INSERT INTO ai_activity_logs (id, user_id, kind, provider, model, ok, prompt_tokens, completion_tokens, meta_json, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
        newId(),
        auth.user.id,
        'assistant',
        res.provider,
        res.model,
        res.usage.promptTokens ?? null,
        res.usage.completionTokens ?? null,
        JSON.stringify({ intent }),
        nowIso()
      );
    } catch (err) {
      aiError = (err as Error).message.slice(0, 300);
    }
  }

  return jsonOk({
    reply,
    intent,
    aiUsed,
    aiError,
    plan: intent === 'plan' ? { items, suggestedTime, timezone: settings.defaultTimezone, campaignId: campaign?.id ?? null, requiresApproval: true } : null,
    counts: {
      total: items.length,
      connected: connected.length,
      notConnected: notConnected.length,
      manual: manual.length,
    },
    suggestedActions:
      intent === 'pause'
        ? [{ id: 'global-pause', label: settings.globalPause ? 'Resume all publishing' : 'Pause all publishing' }]
        : campaign
          ? [{ id: 'open-campaign', label: `Review “${campaign.name}”`, href: `/dashboard/campaigns/${campaign.id}` }]
          : [{ id: 'new-campaign', label: 'Create a campaign', href: '/dashboard/new' }],
  });
});
