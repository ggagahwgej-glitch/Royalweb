import { handler, jsonOk, parseBody } from '@/lib/api';
import { all, get, newId, nowIso, run } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { resolveProvider } from '@/lib/ai/providers';
import { buildDiagnostics } from '@/lib/diagnostics';
import { classifyMessage, guideFor, type ErrorGuide } from '@/lib/errors/guide';
import { nextMorningSlot, formatInZone } from '@/lib/time';
import { draftEmail } from '@/lib/email/draft';
import {
  EXPERT_SYSTEM_PROMPT,
  PLATFORM_VOICE,
  OBJECTION_HANDLING,
  QUALITY_RULES,
} from '@/lib/ai/expertise';
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

type Intent = 'plan' | 'pause' | 'status' | 'diagnose' | 'explain' | 'howto' | 'write' | 'expert' | 'help';

const PLATFORM_ALIASES: Record<string, string[]> = {
  wordpress: ['wordpress', 'wp'],
  blogger: ['blogger', 'blogspot'],
  telegram: ['telegram'],
  discord: ['discord'],
  bluesky: ['bluesky', 'bsky'],
  mastodon: ['mastodon'],
  tumblr: ['tumblr'],
  devto: ['dev.to', 'devto', 'forem'],
  hashnode: ['hashnode'],
  ghost: ['ghost'],
  pinterest: ['pinterest'],
  linkedin: ['linkedin'],
  googlebusiness: ['google business', 'google my business', 'gbp'],
  x: ['twitter', ' x ', 'x/twitter', ' tweet'],
  flickr: ['flickr'],
  youtube: ['youtube', 'shorts'],
  slack: ['slack'],
  matrix: ['matrix'],
  behance: ['behance'],
  dribbble: ['dribbble'],
  quora: ['quora'],
  reddit: ['reddit'],
  indiamart: ['indiamart'],
  justdial: ['justdial'],
  goodfirms: ['goodfirms'],
};

function detectPlatform(lower: string, platforms: { id: string; name: string }[]): string | null {
  for (const platform of platforms) {
    const aliases = PLATFORM_ALIASES[platform.id] ?? [platform.id];
    if (aliases.some((alias) => lower.includes(alias))) return platform.id;
  }
  return null;
}

function detectIntent(lower: string): Intent {
  if (/(fix|repair|recover|unstick|stuck|not working|broken|diagnos|self.?check|health|why (is|isn.t) (it|this) working|nothing (is )?publish)/.test(lower)) {
    return 'diagnose';
  }
  if (/(why|explain|what happened|what does|error|fail|expired|rejected|refused|429|401|403|500|duplicate)/.test(lower)) {
    return 'explain';
  }
  if (/(pause|stop publishing|halt)/.test(lower)) return 'pause';
  if (/(pric(e|ing)|how much|charge|quote|objection|too expensive|positioning|strategy|advice|hook|seo|copy that|headline)/.test(lower)) {
    return 'expert';
  }
  if (/(how do i|how to|how can i|teach|guide|walk me|steps|what should i do|help me understand)/.test(lower)) {
    return 'howto';
  }
  if (/(write|draft|compose|email|subject line|follow.?up note)/.test(lower)) return 'write';
  if (/(status|report|summary|what.s going on|overview)/.test(lower)) return 'status';
  if (/(upload|poster|schedule|plan|publish|tomorrow|today|all platforms|campaign|hashtag|caption|seo)/.test(lower)) {
    return 'plan';
  }
  return 'help';
}

export const POST = handler(async (req, _ctx, auth) => {
  const { message } = await parseBody(req, schema);
  const settings = getSettings(auth.user.id);
  const lower = ` ${message.toLowerCase()} `;
  const intent = detectIntent(lower);

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

  const campaign = get<{ id: string; name: string; status: string; media_count: number }>(
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

  const items: PlanItem[] = platforms.map((p) => {
    const connection: PlanItem['connection'] =
      p.automation === 'manual' ? 'manual' : p.accounts > 0 ? 'connected' : 'not_connected';
    return {
      platformId: p.id,
      platformName: p.name,
      automation: p.automation,
      connection,
      willPublishAutomatically: p.automation !== 'manual' && p.accounts > 0,
      contentStatus: contents.find((c) => c.platform_id === p.id)?.status ?? null,
      note:
        p.automation === 'manual'
          ? 'Manual package — ROYALWEB prepares the caption and image for you to publish.'
          : p.accounts > 0
            ? 'Will publish through the official API once content is approved.'
            : 'No connected account yet — connect one, or publish with the manual package.',
    };
  });

  const connected = items.filter((i) => i.connection === 'connected');
  const notConnected = items.filter((i) => i.connection === 'not_connected');
  const manual = items.filter((i) => i.connection === 'manual');
  const suggestedTime = nextMorningSlot(settings.defaultTimezone);

  // ── real failure data (never invented) ────────────────────────────────────
  const failedJobs = all<{
    id: string;
    status: string;
    error: string | null;
    error_code: string | null;
    platform_id: string;
    platform_name: string;
    campaign_id: string;
    campaign_name: string;
    updated_at: string;
  }>(
    `SELECT j.id, j.status, j.error, j.error_code, j.platform_id, p.name AS platform_name,
            c.id AS campaign_id, c.name AS campaign_name, j.updated_at
       FROM publishing_jobs j JOIN campaigns c ON c.id = j.campaign_id JOIN platforms p ON p.id = j.platform_id
      WHERE c.user_id = ? AND j.status IN ('failed','connection_expired','cancelled','manual_required')
        AND (j.error IS NOT NULL OR j.error_code IS NOT NULL)
      ORDER BY j.updated_at DESC LIMIT 20`,
    auth.user.id
  );

  const mentionedPlatform = detectPlatform(lower, platforms);
  const relevantFailure = mentionedPlatform
    ? failedJobs.find((j) => j.platform_id === mentionedPlatform)
    : failedJobs.find((j) => j.status === 'failed' || j.status === 'connection_expired');

  const failureCode = relevantFailure
    ? relevantFailure.error_code || classifyMessage(relevantFailure.error ?? '')
    : null;
  const failureGuide: ErrorGuide | null = failureCode ? guideFor(failureCode) : null;

  // ── diagnostics for the "fix it" intents ──────────────────────────────────
  const wantsDiagnosis = intent === 'diagnose' || intent === 'howto';
  const diagnostics = wantsDiagnosis ? await buildDiagnostics(auth.user.id) : null;

  const suggestedActions: { id: string; label: string; href?: string; repair?: string }[] = [];
  let draftResponse: { kind: string; subject: string; body: string; template: string } | null = null;
  let reply = '';

  if (intent === 'diagnose' && diagnostics) {
    const top = diagnostics.issues.slice(0, 3);
    reply = [
      `I ran a self-check just now: health ${diagnostics.health}/100 (${diagnostics.status}).`,
      diagnostics.worker.lastHeartbeatAt
        ? `Last worker tick: ${diagnostics.worker.secondsAgo}s ago.`
        : 'The worker has never recorded a heartbeat — scheduled jobs will not run.',
      top.length
        ? `\nWhat needs attention:\n${top
            .map((issue, i) => `${i + 1}. ${issue.title}\n   Why: ${issue.why[0] ?? 'see the guide'}\n   First step: ${issue.steps[0]}`)
            .join('\n')}`
        : '\nDatabase, encryption, worker, queue, connections, storage and sessions all pass their checks.',
      '\nRecovery actions (each requires your confirmation, none of them publishes new content):',
      '• Run worker tick — drains jobs that are already approved, scheduled and due.',
      '• Release interrupted jobs — unlocks jobs that died mid-publish.',
      '• Retry retryable failures — gives permanent failures one more honest attempt.',
      '• Resume publishing — clears a global pause.',
      '\nOpen Diagnostics to execute them with a before/after report.',
    ].join('\n');
    suggestedActions.push({ id: 'open-diagnostics', label: 'Open diagnostics', href: '/dashboard/diagnostics' });
    if (diagnostics.worker.stalled) suggestedActions.push({ id: 'run-tick', label: 'Run worker tick', repair: 'run-tick' });
    if (settings.globalPause) suggestedActions.push({ id: 'resume', label: 'Resume publishing', repair: 'resume-publishing' });
    if (failedJobs.length) suggestedActions.push({ id: 'open-failed', label: 'Review failed posts', href: '/dashboard/failed' });
  } else if (intent === 'explain' && relevantFailure && failureGuide) {
    reply = [
      `I found a real record: ${relevantFailure.platform_name} · “${relevantFailure.campaign_name}” is ${relevantFailure.status.replace(/_/g, ' ')} (${relevantFailure.error_code ?? failureCode}).`,
      '',
      failureGuide.title,
      failureGuide.meaning,
      '',
      'Platform message:',
      `“${(relevantFailure.error ?? 'no message stored').slice(0, 400)}”`,
      '',
      'Why this happens:',
      ...failureGuide.why.map((w) => `• ${w}`),
      '',
      'How to escape it:',
      ...failureGuide.steps.map((s, i) => `${i + 1}. ${s}`),
      '',
      `Do not: ${failureGuide.avoid}`,
    ].join('\n');
    for (const action of failureGuide.actions) {
      suggestedActions.push({
        id: `guide-${action.label.toLowerCase().replace(/[^a-z]+/g, '-')}`,
        label: action.label,
        href: action.href,
        repair: action.repair,
      });
    }
    suggestedActions.push({ id: 'open-failed', label: 'Open failed posts', href: '/dashboard/failed' });
  } else if (intent === 'explain') {
    reply = [
      'I have no failure recorded for that, so I will not invent one.',
      `Right now: ${failedJobs.length} job(s) with a stored error, ${connected.length} connected platform(s), ${notConnected.length} waiting for a connection.`,
      '',
      'If a post is missing from a platform, check Failed Posts first — the platform’s own message is stored there.',
      'If a scheduled post never fired at all, that is a worker problem rather than a platform problem: run Diagnostics.',
    ].join('\n');
    suggestedActions.push({ id: 'open-failed', label: 'Failed posts', href: '/dashboard/failed' });
    suggestedActions.push({ id: 'open-diagnostics', label: 'Run diagnostics', href: '/dashboard/diagnostics' });
  } else if (intent === 'howto' && diagnostics) {
    const issue = diagnostics.issues[0];
    const guide = issue ? guideFor(issue.code) : null;
    reply = [
      'Here is the repeatable recovery method I use, regardless of platform:',
      '1. Read the stored error — never guess. Failed Posts and Security → Publishing log hold the platform’s own words.',
      '2. Classify it: auth (reconnect), permission (role/scope), rate (wait), content (edit), network (host/firewall), duplicate (edit or force).',
      '3. Fix the cause before retrying. Retrying an unfixed cause only burns quota.',
      '4. Retry from the job, not by scheduling a new post — the existing job keeps the idempotency key, so nothing can double-publish.',
      '5. Verify on the platform itself. ROYALWEB only marks a job published when the API returns an ID or URL.',
      '',
      issue
        ? `Your current top issue is: ${issue.title}\nFirst step: ${issue.steps[0]}`
        : 'There is no active issue right now. The same method applies when one appears.',
      guide ? `\nRule for this class of failure: ${guide.avoid}` : '',
      '',
      'Deliberate limits: I will not bypass platform approvals, paid tiers, CAPTCHAs, rate limits or logins. Those are the platform’s rules, not a bug to work around.',
    ].join('\n');
    suggestedActions.push({ id: 'open-diagnostics', label: 'Diagnostics', href: '/dashboard/diagnostics' });
    suggestedActions.push({ id: 'open-failed', label: 'Failed posts', href: '/dashboard/failed' });
  } else if (intent === 'write') {
    const wantsEmail = /(email|e-mail|mail|outreach|follow.?up)/.test(lower);
    if (wantsEmail) {
      const template =
        /(follow.?up|chase)/.test(lower) ? 'follow_up'
        : /(proposal|quote|scope)/.test(lower) ? 'proposal'
        : /(review|testimonial)/.test(lower) ? 'review_request'
        : 'intro';
      const emailInMessage = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/.exec(message)?.[0];
      const recipientBusiness =
        /(?:to|for)\s+([A-Z][\w&'’-]*(?:\s+[A-Z][\w&'’-]*){0,3})/.exec(message)?.[1] ?? '';
      const draft = await draftEmail({
        userId: auth.user.id,
        template,
        recipientName: '',
        recipientBusiness,
        brief: message,
      });
      reply = [
        'Here is a draft written to the standard of a careful human, not a mail-merge:',
        '',
        `Subject: ${draft.subject}`,
        '',
        draft.body,
        '',
        `Mode: ${draft.mode === 'ai' ? 'AI rewrite, facts unchanged' : 'built-in professional template'}.`,
        'Nothing has been sent. Open it in the composer, edit anything that does not sound like you, then send from your own address.',
      ]
        .filter((line) => line !== '')
        .join('\n');
      const query = new URLSearchParams({ template });
      if (emailInMessage) query.set('to', emailInMessage);
      if (recipientBusiness) query.set('name', recipientBusiness);
      suggestedActions.push({ id: 'open-email', label: 'Open in email composer', href: `/dashboard/email?${query.toString()}` });
      draftResponse = { kind: 'email', subject: draft.subject, body: draft.body, template };
      for (const notice of draft.notices.slice(0, 2)) {
        reply += `\n\nNote: ${notice}`;
      }
    } else {
      const voice = mentionedPlatform ? PLATFORM_VOICE[mentionedPlatform] : undefined;
      const hooks = [
        campaign
          ? `“${campaign.name}” — but lead with the customer outcome, not the campaign name.`
          : 'Lead with the customer outcome, not the service name.',
        `Specific detail beats adjectives: use a real number, place or timeframe you can defend.`,
        `Name the reader: ${campaign?.name ? 'the business owner reading it' : 'one kind of business'} — not “everyone”.`,
      ];
      reply = [
        'Copy brief I would give a writer on this account:',
        '',
        `Hook: ${voice?.hookStyle ?? hooks[0]}`,
        `Structure: ${(voice?.structure ?? ['Problem', 'Mechanism', 'Proof', 'One ask']).join(' → ')}`,
        `Tone: ${voice?.tone ?? 'Calm, specific, first person. No hype.'}`,
        `Avoid: ${(voice?.avoid ?? ['invented numbers', 'fake urgency', 'ALL CAPS']).join(', ')}.`,
        '',
        'Three openings that survive editing:',
        ...hooks.map((h) => `• ${h}`),
        '',
        `House rules I will hold you to: ${QUALITY_RULES.slice(0, 3).join(' ')}`,
        'Tell me to draft an email and I will produce a full message with a compliant footer.',
      ].join('\n');
      suggestedActions.push({ id: 'open-email', label: 'Draft an email', href: '/dashboard/email' });
      if (campaign) suggestedActions.push({ id: 'open-campaign', label: 'Open campaign', href: `/dashboard/campaigns/${campaign.id}` });
    }
  } else if (intent === 'expert') {
    const priceRange =
      settings.priceMin && settings.priceMax ? `₹${settings.priceMin}–₹${settings.priceMax}` : 'your published range';
    const objection =
      /(instagram|social media)/.test(lower) ? OBJECTION_HANDLING[0]
      : /(cheap|expensive|price|cost|2,?999|much)/.test(lower) ? OBJECTION_HANDLING[1]
      : /(nephew|relative|already have)/.test(lower) ? OBJECTION_HANDLING[2]
      : /(photo|content|copy)/.test(lower) ? OBJECTION_HANDLING[3]
      : /(customer|lead|immediately)/.test(lower) ? OBJECTION_HANDLING[4]
      : null;
    const voice = mentionedPlatform ? PLATFORM_VOICE[mentionedPlatform] : undefined;
    reply = [
      'Here is how I would handle it, based on how this business actually sells:',
      '',
      objection ? `Question: ${objection.objection}\nAnswer: ${objection.answer}` : '',
      '',
      `Pricing position: publish ${priceRange} as a starting range, scope it in one sentence, and quote anything beyond that separately. Hidden pricing costs more enquiries than a low price ever will.`,
      voice ? `On ${mentionedPlatform}: ${voice.tone} Hook with: ${voice.hookStyle} Avoid: ${voice.avoid.join(', ')}.` : '',
      '',
      'What makes this credible rather than salesy:',
      ...QUALITY_RULES.slice(0, 4).map((rule) => `• ${rule}`),
      '',
      'If you want, I can turn this into platform copy or a follow-up email — I still will not publish or send anything without you.',
    ]
      .filter((line) => line !== '')
      .join('\n');
    suggestedActions.push({ id: 'open-email', label: 'Draft an email', href: '/dashboard/email' });
    suggestedActions.push({ id: 'open-studio', label: 'Content studio', href: '/dashboard/studio' });
  } else if (intent === 'pause') {
    reply = [
      'Publishing can be paused globally or per campaign.',
      `• Global pause stops the worker from publishing anything (current state: ${settings.globalPause ? 'paused' : 'active'}).`,
      '• Per campaign: open the campaign and press Pause — its jobs stay scheduled, not cancelled.',
      '',
      'I will never switch this without your confirmation. Use the button below to toggle it.',
    ].join('\n');
    suggestedActions.push({
      id: 'global-pause',
      label: settings.globalPause ? 'Resume publishing' : 'Pause publishing',
    });
  } else if (intent === 'status') {
    const total = get<{ c: number }>('SELECT COUNT(*) AS c FROM campaigns WHERE user_id = ?', auth.user.id)?.c ?? 0;
    const counts = diagnostics?.counts;
    reply = [
      'Here is the current picture straight from the database:',
      `• Campaigns: ${total}`,
      `• Connected platforms: ${connected.length} of ${items.length}`,
      counts ? `• Pending jobs: ${counts.pendingJobs} · failed: ${counts.failedJobs} · manual pending: ${counts.manualPending}` : '',
      failureGuide && relevantFailure
        ? `\nMost recent error: ${relevantFailure.platform_name} — ${failureGuide.title.toLowerCase()}. First step: ${failureGuide.steps[0]}`
        : '\nNo publishing failures are recorded.',
      '\nI only report what the database confirms. Nothing is marked published until the platform returns an ID or URL.',
    ]
      .filter(Boolean)
      .join('\n');
    suggestedActions.push({ id: 'open-diagnostics', label: 'Diagnostics', href: '/dashboard/diagnostics' });
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
    if (campaign) suggestedActions.push({ id: 'open-campaign', label: 'Open campaign', href: `/dashboard/campaigns/${campaign.id}` });
  } else {
    reply = [
      'I am ROYALWEB AI ASSISTANT. I diagnose and explain; I do not publish on my own.',
      '',
      `Right now: ${connected.length} connected platform(s), ${manual.length} manual platform(s), ${notConnected.length} awaiting a connection.${campaign ? ` Latest campaign: “${campaign.name}”.` : ' No campaign yet.'}`,
      '',
      'I can:',
      '• Explain a specific publishing failure, using the stored platform message.',
      '• Run a self-check and tell you the first step out of each problem.',
      '• Teach the recovery method for auth, permission, rate-limit and duplicate traps.',
      '• Plan which platforms to use and when, with a suggested slot.',
      '',
      'Try: “Why did my LinkedIn post fail?”, “Fix the stuck posts”, “What should I do about rate limits?”',
    ].join('\n');
    suggestedActions.push({ id: 'open-diagnostics', label: 'Run diagnostics', href: '/dashboard/diagnostics' });
  }

  // If an AI provider is configured, let it rewrite the explanation — the
  // deterministic answer above remains the source of truth.
  const provider = resolveProvider(settings.aiProvider, settings.aiModel);
  let aiUsed = false;
  let aiError: string | null = null;
  if (provider) {
    try {
      const res = await provider.chat(
        [
          {
            role: 'system',
            content: `${EXPERT_SYSTEM_PROMPT}

You are inside ROYALWEB AUTOPILOT. Answer the operator, not the customer. Be concise, concrete and calm. Never claim a post was published or an email was sent. Never invent errors, statistics or platform behaviour. Use only the supplied facts and recovery steps. You may not bypass platform approvals, paid tiers, CAPTCHAs, rate limits or consent.`,
          },
          {
            role: 'user',
            content: `Admin message: ${message}\n\nVerified facts (source of truth):\n${JSON.stringify(
              {
                intent,
                deterministicAnswer: reply,
                campaign: campaign ? { name: campaign.name, status: campaign.status, media: campaign.media_count } : null,
                connected: connected.map((c) => c.platformName),
                notConnected: notConnected.map((c) => c.platformName),
                manual: manual.map((c) => c.platformName),
                suggestedTime,
                timezone: settings.defaultTimezone,
                globalPause: settings.globalPause,
                failure: relevantFailure
                  ? {
                      platform: relevantFailure.platform_name,
                      status: relevantFailure.status,
                      errorCode: failureCode,
                      error: relevantFailure.error,
                    }
                  : null,
                diagnostics: diagnostics
                  ? { health: diagnostics.health, status: diagnostics.status, issues: diagnostics.issues.map((i) => i.title) }
                  : null,
              },
              null,
              2
            )}\n\nRewrite the deterministic answer for the admin in their language. Keep every fact, step and warning exactly. Do not add new claims.`,
          },
        ],
        { maxTokens: 800, temperature: 0.4 }
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
      run(
        'INSERT INTO ai_activity_logs (id, user_id, kind, provider, model, ok, error, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        newId(),
        auth.user.id,
        'assistant',
        safe(settings.aiProvider),
        safe(settings.aiModel),
        aiError,
        nowIso()
      );
    }
  }

  return jsonOk({
    reply,
    intent,
    aiUsed,
    aiError,
    plan:
      intent === 'plan'
        ? { items, suggestedTime, timezone: settings.defaultTimezone, campaignId: campaign?.id ?? null, requiresApproval: true }
        : null,
    diagnosis: diagnostics
      ? {
          health: diagnostics.health,
          status: diagnostics.status,
          issues: diagnostics.issues.slice(0, 5).map((i) => ({
            severity: i.severity,
            title: i.title,
            code: i.code,
            firstStep: i.steps[0] ?? '',
          })),
        }
      : null,
    failure: relevantFailure
      ? {
          platformId: relevantFailure.platform_id,
          platformName: relevantFailure.platform_name,
          status: relevantFailure.status,
          code: failureCode,
          message: relevantFailure.error,
          title: failureGuide?.title ?? 'Publishing failure',
          steps: failureGuide?.steps ?? [],
        }
      : null,
    draft: draftResponse,
    counts: { total: items.length, connected: connected.length, notConnected: notConnected.length, manual: manual.length },
    suggestedActions,
  });
});

function safe(value: string | null | undefined): string {
  return value || 'unknown';
}
