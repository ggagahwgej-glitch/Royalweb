/**
 * Error → escape hatch catalogue.
 *
 * Every publishing failure code maps to: what it means, why it happens, and the
 * exact steps an operator can take. The assistant and the diagnostics screen
 * both read from here, so the explanation never drifts from the fix.
 *
 * Deliberately client-safe (no node/server imports) so the dashboard can render
 * it without a round-trip.
 */

export type GuideSeverity = 'error' | 'warning' | 'info';

export interface GuideAction {
  label: string;
  href?: string;
  /** One of the allow-listed repair actions understood by /api/diagnostics/repair */
  repair?: string;
}

export interface ErrorGuide {
  code: string;
  title: string;
  severity: GuideSeverity;
  /** Plain-language meaning, safe to show to a non-technical operator. */
  meaning: string;
  /** The usual root causes, most likely first. */
  why: string[];
  /** Ordered recovery steps. */
  steps: string[];
  actions: GuideAction[];
  /** What NOT to do — the temptation that makes things worse. */
  avoid: string;
}

const DASH = '/dashboard';

export const ERROR_GUIDES: Record<string, ErrorGuide> = {
  no_account: {
    code: 'no_account',
    title: 'No connected account for this platform',
    severity: 'warning',
    meaning: 'ROYALWEB has copy ready, but there is no authorised account to publish it with.',
    why: [
      'The platform was never connected.',
      'The account was disconnected (which cancels its pending jobs).',
      'The account exists but its status is not "connected" (expired or error).',
    ],
    steps: [
      'Open Connected Accounts and connect the platform (or reconnect it).',
      'Press Verify — this performs a real API call and only marks it connected if the platform accepts it.',
      'Return to the campaign, press Schedule again; the existing job is reused, not duplicated.',
      'If you cannot connect it, publish with the manual package instead — the caption and sized image are already prepared.',
    ],
    actions: [
      { label: 'Connect an account', href: `${DASH}/accounts` },
      { label: 'Open manual queue', href: `${DASH}/manual` },
    ],
    avoid: 'Do not paste a personal social password into the app. Use API tokens, app passwords or OAuth.',
  },
  connection_expired: {
    code: 'connection_expired',
    title: 'The platform connection expired',
    severity: 'error',
    meaning: 'The platform rejected the stored credential, so ROYALWEB stopped instead of guessing.',
    why: [
      'The OAuth access token expired and no refresh token was available.',
      'The app password/token was revoked or regenerated on the platform.',
      'The encryption key changed, so stored credentials can no longer be decrypted.',
      'The account lost the required role (e.g. no longer an admin of the page/channel).',
    ],
    steps: [
      'Open Connected Accounts and press Reconnect for that platform.',
      'Generate a fresh token/app password on the platform itself (never reuse a leaked one).',
      'Verify — the platform must accept the credential before the status turns green.',
      'Retry the failed job from Failed Posts. Nothing was published, so retrying cannot duplicate a post.',
    ],
    actions: [
      { label: 'Reconnect account', href: `${DASH}/accounts` },
      { label: 'Review failed jobs', href: `${DASH}/failed` },
      { label: 'Retry all expired jobs', repair: 'requeue-expired' },
    ],
    avoid: 'Do not keep pressing publish. Every attempt fails the same way and burns rate limit.',
  },
  credential_decrypt_failed: {
    code: 'credential_decrypt_failed',
    title: 'Stored credentials cannot be decrypted',
    severity: 'error',
    meaning: 'The encryption key that protected the credentials is not the one in use now.',
    why: [
      'ROYALWEB_ENCRYPTION_KEY changed, or data/.keys/master.key was replaced/restored separately.',
      'The database was copied from another installation without its key.',
    ],
    steps: [
      'Restore the original key (preferred) instead of re-entering every credential.',
      'If the key is lost, reconnect each account — the old ciphertext is unrecoverable by design.',
      'Run Diagnostics to list exactly which accounts are affected.',
    ],
    actions: [
      { label: 'Check credential health', href: `${DASH}/diagnostics` },
      { label: 'Reconnect accounts', href: `${DASH}/accounts` },
    ],
    avoid: 'Do not disable encryption to "fix" this. That would store tokens in plaintext.',
  },
  auth_expired: {
    code: 'auth_expired',
    title: 'The platform says the token is not authorised',
    severity: 'error',
    meaning: 'The API returned 401/403 for the stored credential — it is valid syntax but no longer accepted.',
    why: [
      'Token revoked, expired, or issued for different scopes.',
      'The connected user lost permission on the target page/channel/blog.',
      'The platform app itself was suspended or its access downgraded.',
    ],
    steps: [
      'Reconnect and verify the account.',
      'Confirm the destination (page, board, channel, blog, location) is still one you manage.',
      'If the platform requires approval or a paid plan, complete that in the provider dashboard, then retry.',
    ],
    actions: [
      { label: 'Reconnect', href: `${DASH}/accounts` },
      { label: 'Permission notes per platform', href: `${DASH}/platforms` },
    ],
    avoid: 'Do not create a second app/token repeatedly — that hides the real permission problem.',
  },
  permission_denied: {
    code: 'permission_denied',
    title: 'The account is not allowed to do this',
    severity: 'error',
    meaning: 'Authentication worked, but the platform refuses this specific action for this account.',
    why: [
      'Missing scope (e.g. company-page posting needs organisation permissions).',
      'The user is not an admin of the target page/board/channel/location.',
      'The platform requires an approved app, business verification or a paid tier.',
      'The destination was deleted or transferred to another owner.',
    ],
    steps: [
      'Read the exact message in the job error — platforms usually name the missing permission.',
      'Check Settings → Integrations for the scopes requested by this app.',
      'Ask the page/channel owner to grant the role, or choose a destination you personally control.',
      'Reconnect after the permission changes, then retry.',
    ],
    actions: [
      { label: 'Platform permission notes', href: `${DASH}/platforms` },
      { label: 'Integration settings', href: `${DASH}/settings` },
    ],
    avoid: 'Do not use unofficial endpoints or browser automation to get around permissions.',
  },
  rate_limited: {
    code: 'rate_limited',
    title: 'The platform is rate limiting this account',
    severity: 'warning',
    meaning: 'The platform accepted the credentials but asked ROYALWEB to slow down.',
    why: [
      'Too many posts in a short window.',
      'Several platforms share one IP/account quota.',
      'The platform has a daily cap (X, Pinterest and Google are the usual suspects).',
    ],
    steps: [
      'Wait for the retry window shown on the job — ROYALWEB schedules it automatically.',
      'Reduce posting frequency in Settings → Publishing.',
      'Spread platforms across the day using per-platform times instead of one burst.',
      'Check the platform dashboard for an explicit quota reset time.',
    ],
    actions: [
      { label: 'Posting frequency', href: `${DASH}/settings` },
      { label: 'Calendar', href: `${DASH}/calendar` },
    ],
    avoid: 'Do not retry in a loop or add proxy rotation. That is how accounts get banned.',
  },
  quota_exceeded: {
    code: 'quota_exceeded',
    title: 'The API quota is exhausted',
    severity: 'warning',
    meaning: 'The platform counts this call against a daily/monthly allowance and it is used up.',
    why: [
      'YouTube uploads cost 1,600 units of a 10,000/day default quota.',
      'The API plan has a fixed monthly cap.',
      'Other tools using the same API key consumed the allowance.',
    ],
    steps: [
      'Wait for the quota reset (usually midnight Pacific for Google).',
      'Request a quota increase in the provider console if this is routine.',
      'Publish the remaining platforms now and schedule this one for tomorrow.',
    ],
    actions: [
      { label: 'Move this job later', href: `${DASH}/scheduled` },
      { label: 'Platform limits', href: `${DASH}/platforms` },
    ],
    avoid: 'Do not create extra API projects to multiply free quota — that violates most provider terms.',
  },
  platform_disabled: {
    code: 'platform_disabled',
    title: 'The platform is disabled in ROYALWEB',
    severity: 'warning',
    meaning: 'You switched this platform off, so jobs for it are refused before any network call.',
    why: ['It was disabled to pause a channel temporarily.', 'A previous incident prompted a manual shut-off.'],
    steps: [
      'Open All Platforms and enable it again.',
      'Retry the job from Failed Posts (nothing was sent, so nothing can duplicate).',
    ],
    actions: [
      { label: 'Enable platform', href: `${DASH}/platforms` },
      { label: 'Failed posts', href: `${DASH}/failed` },
    ],
    avoid: 'Do not delete and recreate the account — enabling the platform is enough.',
  },
  duplicate_prevented: {
    code: 'duplicate_prevented',
    title: 'Identical copy was blocked as a duplicate',
    severity: 'info',
    meaning: 'The same fingerprint was already published on this platform inside the duplicate window.',
    why: [
      'The campaign was scheduled twice with unchanged copy.',
      'A recurring daily/weekly cycle reused the same caption.',
      'The same poster was published to the same platform from a second campaign.',
    ],
    steps: [
      'Edit the caption so it is genuinely different, then schedule again.',
      'Or press "Publish anyway" on the job if republishing is intentional.',
      'Shorten the duplicate window in Settings → Publishing if your cadence is faster.',
    ],
    actions: [
      { label: 'Open the campaign', href: `${DASH}/scheduled` },
      { label: 'Duplicate window', href: `${DASH}/settings` },
    ],
    avoid: 'Do not spam the same promo daily. Platform algorithms and users both punish it.',
  },
  missing_content: {
    code: 'missing_content',
    title: 'The job has no content attached',
    severity: 'error',
    meaning: 'The job points at a content row that no longer exists.',
    why: ['The campaign content was regenerated and the old row removed', 'Manual database edits'],
    steps: [
      'Generate content for the campaign again.',
      'Approve it, then schedule the platform again — a fresh job is created.',
    ],
    actions: [{ label: 'Open studio', href: `${DASH}/studio` }],
    avoid: 'Do not edit the SQLite file by hand while the worker is running.',
  },
  video_required: {
    code: 'video_required',
    title: 'This platform needs a video, not a poster',
    severity: 'warning',
    meaning: 'YouTube Shorts cannot be published from a still image, so ROYALWEB refused.',
    why: [
      'No MP4 was uploaded to the campaign.',
      'ffmpeg is not installed, so the poster could not be rendered into a vertical clip.',
    ],
    steps: [
      'Install ffmpeg on the server (or set FFMPEG_PATH) and retry — a 12s 1080×1920 clip is rendered automatically.',
      'Or upload a vertical MP4 to the campaign and retry.',
      'Or deselect YouTube for this campaign and use the manual package.',
    ],
    actions: [
      { label: 'Check renderer', href: `${DASH}/diagnostics` },
      { label: 'Media library', href: `${DASH}/media` },
    ],
    avoid: 'Never rename a JPG to .mp4 or pad a still image and call it a Short.',
  },
  public_url_missing: {
    code: 'public_url_missing',
    title: 'The platform needs a public image URL',
    severity: 'warning',
    meaning: 'Some APIs fetch images from a URL instead of accepting an upload, and no public base URL is configured.',
    why: ['PUBLIC_BASE_URL is unset.', 'The deployment is not reachable from the internet (local only).'],
    steps: [
      'Set PUBLIC_BASE_URL to the public HTTPS origin of this app and restart.',
      'Verify the link works from a phone on mobile data, not just your machine.',
      'Retry the job — media is attached automatically once the URL resolves.',
    ],
    actions: [
      { label: 'Integration environment', href: `${DASH}/settings` },
      { label: 'Diagnostics', href: `${DASH}/diagnostics` },
    ],
    avoid: 'Do not expose the admin dashboard publicly just to host images.',
  },
  ai_not_configured: {
    code: 'ai_not_configured',
    title: 'No AI provider configured',
    severity: 'info',
    meaning: 'Content was produced by the built-in template engine, not by a language model.',
    why: ['No API key was added in Settings → AI.', 'The provider rejected the key and the engine fell back.'],
    steps: [
      'Add a provider and key in Settings → AI, then press Test.',
      'Regenerate content — the campaign view labels each draft as AI or Template.',
    ],
    actions: [
      { label: 'Configure AI', href: `${DASH}/settings` },
      { label: 'AI activity log', href: `${DASH}/studio` },
    ],
    avoid: 'Do not assume template copy is poster-aware. Only a vision model reads the image.',
  },
  upstream_error: {
    code: 'upstream_error',
    title: 'The platform returned a server error',
    severity: 'warning',
    meaning: 'The request reached the platform but it failed on their side (usually HTTP 5xx).',
    why: ['Provider incident or maintenance.', 'Payload edge case the platform rejects.'],
    steps: [
      'Check the provider status page.',
      'Let the automatic retry (2, 4, 8 minutes) finish.',
      'If it repeats, retry manually with "Force" and inspect the stored error text.',
    ],
    actions: [
      { label: 'Failed posts', href: `${DASH}/failed` },
      { label: 'Publishing log', href: `${DASH}/security` },
    ],
    avoid: 'Do not reinstall or change credentials for a platform-side outage.',
  },
  network_error: {
    code: 'network_error',
    title: 'ROYALWEB could not reach the platform',
    severity: 'warning',
    meaning: 'DNS, TLS or connectivity failed before the request completed.',
    why: [
      'The server has no outbound internet access or is behind a restrictive firewall.',
      'A self-hosted endpoint (WordPress, Mastodon, Ghost, Matrix) uses http on a private host.',
      'Invalid site URL or a proxy intercepting TLS.',
    ],
    steps: [
      'Run Diagnostics → network reachability for the platform host.',
      'Confirm the site URL includes https:// and the correct path for WordPress.',
      'Allow outbound 443 from the server, then retry.',
    ],
    actions: [
      { label: 'Run diagnostics', href: `${DASH}/diagnostics` },
      { label: 'Review account URL', href: `${DASH}/accounts` },
    ],
    avoid: 'Do not disable TLS verification to make a self-signed certificate work in production.',
  },
  timeout: {
    code: 'timeout',
    title: 'The platform did not answer in time',
    severity: 'warning',
    meaning: 'The request was accepted but no response arrived before the timeout.',
    why: ['Large media upload on a slow link.', 'Provider latency spike.'],
    steps: [
      'The job is retried automatically; check whether the post actually appeared before forcing a retry.',
      'Shrink large posters or upload a smaller MP4.',
    ],
    actions: [
      { label: 'Published posts', href: `${DASH}/published` },
      { label: 'Failed posts', href: `${DASH}/failed` },
    ],
    avoid: 'Do not force-retry blindly after a timeout — the post may already exist on the platform.',
  },
  adapter_exception: {
    code: 'adapter_exception',
    title: 'The integration hit an unexpected error',
    severity: 'error',
    meaning: 'The adapter threw before the platform could answer. Nothing was published.',
    why: ['A response shape changed at the provider.', 'Missing account metadata (board id, blog id, channel).'],
    steps: [
      'Open Security → Publishing log for the last step recorded before the crash.',
      'Reconnect the account so metadata (board/blog/channel id) is refreshed.',
      'Retry once; if it repeats, the adapter for that platform needs a code update.',
    ],
    actions: [
      { label: 'Publishing log', href: `${DASH}/security` },
      { label: 'Reconnect', href: `${DASH}/accounts` },
    ],
    avoid: 'Do not paste API responses into public issues — they can contain account identifiers.',
  },
  worker_stalled: {
    code: 'worker_stalled',
    title: 'The publishing worker is not running',
    severity: 'error',
    meaning: 'Scheduled jobs are due but nothing is claiming them — no tick has been recorded recently.',
    why: [
      'The server process restarted and the worker did not start (ROYALWEB_DISABLE_WORKER=1).',
      'A serverless deployment has no long-lived process and no cron configured.',
      'The tick endpoint is blocked by a proxy or missing worker secret.',
    ],
    steps: [
      'Press "Run worker tick" here — a healthy tick publishes due jobs and records a heartbeat.',
      'For serverless hosting, schedule POST /api/worker/tick every 1–5 minutes with header x-worker-secret.',
      'Or run `npm run worker` on any always-on machine pointing at the same database.',
      'If ROYALWEB_DISABLE_WORKER is set on the web instance, that is expected — keep the external worker running.',
    ],
    actions: [
      { label: 'Run worker tick', repair: 'run-tick' },
      { label: 'Requeue overdue jobs', repair: 'requeue-overdue' },
    ],
    avoid: 'Do not schedule every job to "now" repeatedly — that creates a burst that triggers rate limits.',
  },
  global_pause: {
    code: 'global_pause',
    title: 'Publishing is paused',
    severity: 'info',
    meaning: 'A deliberate pause is holding jobs back. They stay scheduled, not cancelled.',
    why: ['Global pause was enabled in Settings → Publishing.', 'A campaign was paused individually.'],
    steps: [
      'Resume publishing here or in Settings → Publishing.',
      'Overdue jobs fire on the next tick; stagger them if many accumulated.',
    ],
    actions: [
      { label: 'Resume publishing', repair: 'resume-publishing' },
      { label: 'Settings', href: `${DASH}/settings` },
    ],
    avoid: 'Do not resume during a known platform outage — you will just collect failures.',
  },
  media_missing: {
    code: 'media_missing',
    title: 'The poster or video is missing',
    severity: 'error',
    meaning: 'A media row referenced by the campaign is deleted or its file is gone from disk.',
    why: ['The poster was deleted (pending jobs are cancelled automatically).', 'data/uploads was moved or cleaned.'],
    steps: [
      'Upload the poster again to the campaign.',
      'Regenerate the media derivatives by scheduling the platform again.',
      'Check Diagnostics for orphaned files.',
    ],
    actions: [
      { label: 'Open media library', href: `${DASH}/media` },
      { label: 'Diagnostics', href: `${DASH}/diagnostics` },
    ],
    avoid: 'Do not delete files under data/uploads by hand while the app is running.',
  },
  validation_error: {
    code: 'validation_error',
    title: 'Some input was rejected',
    severity: 'warning',
    meaning: 'The request failed validation before any platform call.',
    why: ['A required field was empty.', 'A price/URL/date was malformed.'],
    steps: [
      'Read the field name in the error detail and correct it.',
      'Prices should be plain text (e.g. ₹2,999). URLs must start with https://.',
    ],
    actions: [
      { label: 'Campaign settings', href: `${DASH}/new` },
      { label: 'Business profile', href: `${DASH}/settings` },
    ],
    avoid: 'Do not bypass validation by editing the database.',
  },
  unknown: {
    code: 'unknown',
    title: 'Unclassified failure',
    severity: 'warning',
    meaning: 'The job failed with a code that has no guide yet.',
    why: ['A new platform error that has not been mapped.', 'An unexpected adapter response.'],
    steps: [
      'Open Security → Publishing log and read the last recorded step and message.',
      'Run Diagnostics for a system-level check.',
      'Retry once; if it persists, copy the message into the integration docs for that platform.',
    ],
    actions: [
      { label: 'Publishing log', href: `${DASH}/security` },
      { label: 'Diagnostics', href: `${DASH}/diagnostics` },
    ],
    avoid: 'Do not assume the post exists. Check the platform before retrying.',
  },
};

export function guideFor(code: string | null | undefined): ErrorGuide {
  if (code && ERROR_GUIDES[code]) return ERROR_GUIDES[code];
  return { ...ERROR_GUIDES.unknown, code: code || 'unknown' };
}

/** Map a raw platform message onto a guide when the adapter only gave text. */
export function classifyMessage(message: string): string {
  const m = message.toLowerCase();
  if (/duplicate/.test(m)) return 'duplicate_prevented';
  if (/decrypt/.test(m)) return 'credential_decrypt_failed';
  if (/rate.?limit|too many requests|429/.test(m)) return 'rate_limited';
  if (/quota/.test(m)) return 'quota_exceeded';
  if (/permission|forbidden|not (an )?(admin|authorised|authorized)|403/.test(m)) return 'permission_denied';
  if (/unauthor|expired|invalid.{0,12}(token|credential)|401/.test(m)) return 'auth_expired';
  if (/timeout|timed out/.test(m)) return 'timeout';
  if (/network|enotfound|econn|dns|tls|socket/.test(m)) return 'network_error';
  if (/5\d\d|server error|internal error/.test(m)) return 'upstream_error';
  if (/video|ffmpeg|short/.test(m)) return 'video_required';
  if (/public.{0,10}url|public_base_url/.test(m)) return 'public_url_missing';
  if (/no .{0,40}account|not connected/.test(m)) return 'no_account';
  if (/disabled/.test(m)) return 'platform_disabled';
  return 'unknown';
}
