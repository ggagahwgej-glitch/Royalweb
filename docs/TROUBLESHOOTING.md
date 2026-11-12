# Recovery playbook — how to escape every trap

This is the operator manual for ROYALWEB AUTOPILOT when something stops working.
It is written so that a non-developer can resolve the common traps without editing code, and so a developer
can see exactly which invariant is being enforced.

Two screens do most of the work:

- **Diagnostics** (`/dashboard/diagnostics`) — runs live probes against the database, encryption, worker,
  queue, connections, disk and sessions, scores health, and offers explicit repair actions.
- **AI Assistant** (`/dashboard/assistant`) — explains a real stored failure, teaches the recovery method, and
  can trigger the same audited repairs.

Neither screen can publish new content on its own. Publishing only happens for content you approved and
scheduled, through the worker.

---

## The five-step method (works for every platform)

1. **Read the stored error.** Failed Posts, the campaign log, and Security → Publishing log contain the
   platform's own words. Never guess.
2. **Classify it.** Auth · permission · rate limit · content · network · duplicate · configuration.
3. **Fix the cause, not the symptom.** Retrying an unchanged cause burns quota and can lock the account.
4. **Retry the existing job**, don't create a new post. The job keeps its idempotency key, so a retry can never
   double-publish.
5. **Verify on the platform.** ROYALWEB marks a job published only when the API returns an ID or URL.

---

## Trap 1 — "Scheduled posts never go out"

**Symptom:** jobs sit in `SCHEDULED`, `scheduled_at` is in the past, nothing changes.

**Why:** nothing is driving the queue. Either the in-process worker is off, the process is asleep, or this is
a serverless deployment with no cron.

**Escape:**
1. Diagnostics → **Run worker tick**. If it processes jobs, the queue was simply not being drained.
2. If Diagnostics says *no heartbeat*, make the worker persistent:
   - normal server: ensure `ROYALWEB_DISABLE_WORKER` is not `1` and restart;
   - serverless: call `POST /api/worker/tick` every 1–5 min with the `x-worker-secret` header;
   - separate host: `npm run worker`.
3. **Run them now** (Diagnostics) only if many jobs are overdue; otherwise the next tick handles it.

**Do not:** mass-reschedule every post to "now". A burst trips platform rate limits and looks like spam.

---

## Trap 2 — "It worked yesterday, now the platform rejects the token"

**Symptom:** job status `CONNECTION EXPIRED`, error `401`, `invalid token`, `revoked`, or `decrypt`.

**Why:** OAuth access token expired without a refresh token; app password regenerated; account lost its role;
or the encryption key changed so stored credentials can't be decrypted.

**Escape:**
1. Connected Accounts → **Reconnect** and **Verify**. Verification performs a real API call; a green state
   means the platform accepted it.
2. If the key changed: restore `ROYALWEB_ENCRYPTION_KEY` (or `data/.keys/master.key`). If it is lost, reconnect
   every account — the ciphertext is unrecoverable by design.
3. Diagnostics → **Retry jobs for reconnected accounts** — only jobs whose platform now has a working account
   are requeued.

**Do not:** disable encryption, paste personal passwords, or create a new OAuth app on every failure. Those
hide the real permission problem.

---

## Trap 3 — "Content is ready but nothing published" (`MANUAL ACTION REQUIRED`)

**Symptom:** job status `MANUAL ACTION REQUIRED`, error mentions no account.

**Why:** there is no connected account (or the platform is Group C / manual by design).

**Escape:**
- Group A/B: connect and verify the platform, then retry the job — the existing job is reused.
- Group C (Behance, Dribbble, Quora, Reddit, IndiaMART, Justdial, GoodFirms): download the manual package
  (caption, title, tags, sized image, instructions), post it yourself, then mark the task published with the
  URL. That is the honest state: no API exists, so no automation is faked.

**Do not:** ask for browser automation, CAPTCHA solving, proxy rotation or "just try logging in". None of that
is implemented, and none of it is safe.

---

## Trap 4 — Duplicate detected / post "silently skipped"

**Symptom:** job status `CANCELLED`, error mentions the duplicate window.

**Why:** the same content fingerprint was already published on that platform inside the window (default 72 h).
This is intentional anti-spam behaviour, not a bug.

**Escape:**
1. Edit the caption so it is genuinely different (the fingerprint covers title, caption, description and
   hashtags).
2. Or press **Publish anyway** on the job when the repeat is deliberate.
3. Adjust the window in Settings → Publishing if your cadence is faster.

**Do not:** lower the window to zero and repost the same offer daily on every platform.

---

## Trap 5 — Rate limited (`429`) or quota exhausted

**Escape:**
1. Wait for the retry time on the job — backoff is 2, 4 then 8 minutes, then a permanent failure you can retry.
2. Reduce posting frequency (Settings → Publishing) and spread platforms across the day (per-platform times).
3. X requires a paid API tier; YouTube uploads cost 1,600 quota units each; Google/Pinterest have daily caps.
4. If it is a hard quota, move the job to tomorrow rather than hammering it.

**Do not:** rotate proxies, add API keys from other projects, or loop retries. That is how accounts get banned.

---

## Trap 6 — "Connected, but not allowed" (`403`)

**Escape:**
1. Read the platform message — it usually names the missing scope or role.
2. Check the requirement in All Platforms → permission notes (e.g. LinkedIn company pages need Community
   Management access and an admin role; Pinterest needs standard access; Google Business Profile needs
   approval; Hashnode publishing must be enabled for the account).
3. Fix it in the provider's own dashboard, reconnect, then retry.

**Do not:** use unofficial endpoints or a different account to evade a permission you were not granted.

---

## Trap 7 — Image missing on Blogger / Ghost / DEV.to / Pinterest / Google

**Why:** those APIs fetch the image from a public URL, and `PUBLIC_BASE_URL` is not set (or the URL is not
reachable from the internet).

**Escape:**
1. Set `PUBLIC_BASE_URL=https://your-domain` and restart.
2. Confirm `https://your-domain/api/public/media/...` works from a phone on mobile data.
3. Retry the job — the signed image URL is attached automatically.

---

## Trap 8 — YouTube Shorts refuses a poster (`video_required`)

**Why:** a Short is a video. A still image is never silently uploaded as one.

**Escape:** install `ffmpeg` (or set `FFMPEG_PATH`) so a 12-second 1080×1920 clip is rendered, or upload a
vertical MP4 to the campaign, or deselect YouTube and use the manual package.

**Do not:** rename a JPG to `.mp4` or pad a still frame into a fake video.

---

## Trap 9 — "Publishing is paused" and nothing moves

**Why:** global pause, campaign pause, or `autoPublishEnabled` off.

**Escape:** Diagnostics → **Resume publishing**, or turn the switch off in Settings → Publishing. Jobs stay
scheduled during a pause — they are not lost.

---

## Trap 10 — Health score dropped / database or disk problems

- **Database integrity failed:** stop the app, restore the newest `data/royalweb.db` backup. Do not keep
  writing to a corrupt file.
- **Disk < 0.5 GB:** free space, move `data/uploads` to a larger volume, then restart. Uploads and SQLite
  writes can fail mid-way when the disk is full.
- **Credentials unreadable:** see Trap 2 (key mismatch).

---

## What ROYALWEB deliberately will not do

These are not missing features; they are boundaries that keep the account, the business and the law safe:

| Request | Response |
| --- | --- |
| Bypass a CAPTCHA or login | Not implemented. Use the official API or the manual package. |
| Rotate proxies to avoid rate limits | Not implemented. Slow down instead. |
| Post without an approved account | Impossible: publishing requires a `connected` account and approved content. |
| Claim a post was published when the API failed | Never. Failure is stored verbatim. |
| Invent impressions/likes | Never. Analytics marks them unavailable. |
| Scrape platforms or use private endpoints | Not implemented. |
| Store plaintext tokens or email passwords | Never. AES-256-GCM at rest, OAuth/app passwords only. |

---

## Escalation checklist (before asking a developer)

1. Diagnostics health score and the exact failing check.
2. The job ID, platform, status and full stored error (Security → Publishing log).
3. Whether the same content posted successfully on another platform.
4. Whether the platform's own dashboard shows the post (it may exist despite a timeout).
5. Recent changes: env vars, encryption key, domain, hosting, platform plan.

With those five facts, almost every remaining bug is reproducible in minutes.
