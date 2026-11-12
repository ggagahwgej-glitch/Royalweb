# ROYALWEB AUTOPILOT

**AI-powered multi-platform publishing, marketing distribution and content automation** for ROYALWEB —
a website design & development business.

Upload one promotional poster, let the AI prepare platform-native content, approve it, and publish through
official APIs to 18 platforms. For the 7 platforms without a supported publishing API, ROYALWEB prepares a
complete, downloadable publishing package and tracks it as a manual task.

> **Honesty is a feature.** Every "published" state comes from a platform API response. Failures are stored
> with the platform's own error text. Metrics that platforms do not expose are labelled *unavailable*, never
> invented.

---

## What is actually implemented

| Area | Status |
| --- | --- |
| Admin auth (scrypt + hashed session tokens, HttpOnly cookies, CSRF, rate limits, lockouts) | ✅ working |
| SQLite persistence with versioned migrations (12+ tables, FKs, indexes, unique constraints) | ✅ working |
| Media upload, original preservation, Sharp derivatives per platform, thumbnails | ✅ working |
| Poster analysis (real image metrics; AI vision when a provider is configured) | ✅ working |
| Platform-specific content generation (AI provider **or** built-in template fallback) | ✅ working |
| 25 platform adapters in separate files with verify + publish + error handling | ✅ implemented |
| Publishing engine: atomic job claiming, idempotency keys, duplicate-content guard, backoff retries | ✅ working |
| Scheduling: immediate, custom time, daily/weekly recurrence, timezones, per-platform selection | ✅ working |
| Manual publishing center with ZIP packages and copy buttons | ✅ working |
| Analytics from real records (no fake engagement) | ✅ working |
| AI assistant that plans but never publishes autonomously | ✅ working |
| Security center: sessions, audit log, credential health, password rotation | ✅ working |
| Self-diagnosis + audited repairs (worker, queue, encryption, disk, connections) | ✅ working |
| Email outreach from your own verified SMTP address, with compliance guard | ✅ working |
| Expert writing layer (voice, quality gate, pricing/objection guidance) | ✅ working |
| YouTube Shorts video rendering | ⚠️ requires `ffmpeg` on the server (Poster→MP4 renderer) |

### The 25 platforms

- **Group A — automatic publishing candidates (10):** WordPress, Blogger, Telegram, Discord, Bluesky,
  Mastodon, Tumblr, DEV.to, Hashnode, Ghost
- **Group B — official API / approval-dependent (8):** Pinterest, LinkedIn, Google Business Profile, X,
  Flickr, YouTube Shorts, Slack, Matrix
- **Group C — manual / assisted publishing (7):** Behance, Dribbble, Quora, Reddit, IndiaMART, Justdial,
  GoodFirms

Each integration is its own adapter under `src/lib/platforms/adapters/` with independent authentication,
permission checks, content formatting, media handling, publishing logic and status verification — see
[docs/PLATFORM_INTEGRATIONS.md](docs/PLATFORM_INTEGRATIONS.md) for the capability matrix, endpoints,
approval requirements and known constraints.

---

### Onboarding in minutes, not evenings

**Connected Accounts** opens with a quick-connect wizard: a direct *Get key ↗* deep link plus a one-line
instruction for every one of the 25 platforms, a collapsible paste grid with clipboard buttons, tier filters
(*Fastest to connect* vs *OAuth / approval* vs *Manual*) and a single **Save & verify all**. Unfilled platforms
stay quietly inactive — connect two, publish today, add the rest when the APIs are approved. See
[docs/QUICK_CONNECT.md](docs/QUICK_CONNECT.md).

### Automation and multi-client workspaces

- **External alerts** (Telegram + alert email + webhook) when the worker dies, a token expires permanently or
  a retry sequence runs out; every attempt is logged with the channel result.
- **Encrypted full-database snapshots** on a daily/weekly schedule, downloadable and restorable offline with
  `npm run db:restore`.
- **RSS/blog ingestion**: a feed article becomes a campaign with all 25 platform drafts, held for approval.
- **Evergreen recycling**: re-queue a finished campaign after 60–90 days with a light, clearly-labelled
  variation — as a draft, never a verbatim repost.
- **Email warm-up + IMAP reply detection**: a ramping daily cap that refuses over-limit sends with HTTP 429,
  and follow-ups that pause themselves the moment a lead replies.
- **Workspaces** per client: isolated accounts, sender identity, campaigns and calendar, switchable from the
  sidebar.

See [docs/AUTOMATION.md](docs/AUTOMATION.md) for behaviour, limits and API endpoints.

## Deploying

The app needs a **disk** for its SQLite database, uploads and snapshots. That is one command on Docker,
Railway, Render, Fly.io or any VPS (`Dockerfile`, `railway.json` and `fly.toml` are included). Vercel builds and
runs too — with cron-driven publishing — but its filesystem is ephemeral, so it is a demo/preview target unless
you attach durable storage. `/api/health` always reports which mode you are in.

Full instructions, plan limits and a troubleshooting table: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Quick start

```bash
npm install
cp .env.example .env.local      # optional; fill in what you have
npm run dev                     # http://localhost:3000
```

On first boot the platform catalogue is seeded automatically. Open the app and either:
- set `ROYALWEB_ADMIN_EMAIL` + `ROYALWEB_ADMIN_PASSWORD` before starting, or
- use the first-run setup form on `/login`.

Then: **Settings → Business** (your real business details, prices, links), **Settings → AI** (optional API
key), **Connected Accounts** (connect Telegram/WordPress/LinkedIn…), and **Create Campaign**.

Retyping credentials after a reset is optional: whatever is in `.env.local`
(`ROYALWEB_SMTP_*`, `ROYALWEB_AI_API_KEY`, OAuth client IDs, or a
`ROYALWEB_CREDENTIALS` JSON object) is pre-filled automatically on first run as
*unverified* accounts, and **Settings → Backup & onboarding** exports/restores
everything as one passphrase-encrypted file. See [docs/BACKUP.md](docs/BACKUP.md).

Full deployment and per-platform setup: [docs/SETUP.md](docs/SETUP.md).

### What you must supply (cannot be generated by code)

| Needed | Why | Where |
|---|---|---|
| Admin email + password | Owner of the dashboard | `.env.local` or first-run screen |
| Platform credentials / OAuth apps | Nothing can be published without your accounts | `.env.local` (pre-filled on first run), Settings → Backup & onboarding (restore), Settings → Integrations, Connected Accounts |
| Paid or approved API access | X requires a paid tier; Pinterest standard access, LinkedIn Community Management, Google Business Profile and Hashnode publishing all require provider approval | Provider dashboards (see integration matrix) |
| `PUBLIC_BASE_URL` | Some platforms fetch images by URL instead of accepting an upload | Environment |
| `ffmpeg` on the server | YouTube Shorts requires a video, never a still poster | System package (optional) |
| AI provider key | Higher-quality, poster-aware copy; otherwise the labelled template engine is used | Settings → AI (optional) |

Nothing in this list is simulated: until an item exists, the UI shows the real status
(`APPROVAL REQUIRED`, `MANUAL PUBLISHING AVAILABLE`, `not connected`) instead of pretending it works.

### Verify it works end-to-end

```bash
npm run typecheck
npm run build
npm run dev &                   # or npm start after build
TEST_EMAIL=you@example.com TEST_PASSWORD='your-password' npm run acceptance
```

The acceptance script exercises login, upload, original preservation, content generation, all 25 platforms,
scheduling persistence, pause behaviour, manual packages, error reporting and secret exposure. It prints a
pass/fail table; anything requiring third-party credentials is reported as *skipped, needs credentials*
rather than faked.

**Last recorded run:** 54 passed · 0 failed · 1 skipped (55 checks) on Node 22 / Next 15.5.29 — full output,
including how each requirement was proven and what was *not* executed, is in
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). The onboarding checks (T31–T35) need the server started with a
test `.env.local` fixture; without it they are reported as skipped, never as passed.

---

## Architecture

```
src/
  app/
    login, dashboard/*              17 dashboard sections (server-rendered shells)
    api/                            REST surface (auth, media, campaigns, jobs, accounts, oauth…)
  components/                       Design system + interactive views
  lib/
    db/                             node:sqlite connection, migrations, serializers
    auth.ts crypto.ts secrets.ts    Sessions, AES-256-GCM, scrypt, encrypted app secrets
    media/                          Sharp derivatives, signed public URLs, ffmpeg renderer
    platforms/                      25 adapters + shared HTTP/error classification
    ai/                             Provider-agnostic AI layer + template engine
    publishing/                     Job engine + in-process worker
    diagnostics.ts                  Self-diagnosis + audited repairs
    email/                          SMTP sender, templates, AI drafting, suppression
    backup.ts env-seed.ts           Encrypted credential backup/restore, .env.local pre-fill
    ai/expertise.ts                 Voice, platform craft, objections, ethics
    ai/quality.ts                   Spam/shouting/limit clean-up + claim flags
    errors/guide.ts                 Failure → escape-route catalogue
    settings.ts time.ts validation.ts
  instrumentation.ts                Starts the publishing worker once per server process
scripts/                            db CLI, standalone worker, acceptance tests
docs/                               setup, integration matrix, security, backup, troubleshooting
```

**Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, SQLite (`node:sqlite`, built into
Node 22 — no native compilation), Sharp, Zod. No external services are required; AI and OAuth providers are
optional plugins.

**Data:** `data/royalweb.db` (WAL) and `data/uploads/` — both git-ignored. Originals live in
`data/uploads/<uuid>.<ext>`; derivatives in `data/uploads/derived/<mediaId>/<platform>.jpg`.

**Worker:** starts with the server (20s tick) and is also exposed as `POST /api/worker/tick` for cron or
`npm run worker`. Jobs are claimed with a conditional UPDATE so two workers can never publish the same job.

---

## Publishing model (how a post actually goes out)

1. Upload poster → stored byte-for-byte, hashed, analysed.
2. Campaign created → platform(s) selected.
3. Content generated as **drafts** per platform (AI or template engine), each with a content hash.
4. Human reviews/edits and **approves** each platform.
5. Scheduling creates `publishing_jobs` (or `manual_tasks` for Group C), with a unique idempotency key.
6. Worker claims a due job atomically, checks the campaign/account/global-pause state, builds the platform
   image, decrypts credentials and calls the adapter.
7. Success → `published_posts` row with the platform's ID/URL; failure → error code, retry policy, logs.
8. Duplicate content is blocked inside the configurable window unless you explicitly force a retry.

Nothing can be published without an approved content row and a `connected` account.

---

## Security summary

- Passwords: scrypt (N=16384), per-password salt, constant-time comparison, 8-attempt lockout.
- Sessions: 256-bit random tokens stored only as SHA-256 hashes; HttpOnly, SameSite=Lax, 12h TTL, revocable.
- CSRF: Origin/Sec-Fetch-Site validation + required custom header on all mutations.
- Credentials: AES-256-GCM at rest, never serialized to the client, never in localStorage or bundles.
- Credential backups: scrypt (N=32768) → AES-256-GCM with a passphrase-derived key, header bound as AAD; exports and
  imports are admin-only, rate-limited and audited by key name and count (never by value).
- Rate limits: login (IP + account), uploads, generation, scheduling.
- Contact privacy: email/phone are excluded from all generated content unless you explicitly enable it.
- Audit trail for every administrative action; publishing log for every adapter call.

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and operational checklist, and
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for the recovery playbook (every failure trap, its cause
and the exact escape route — including what the app deliberately refuses to bypass),
[docs/EMAIL.md](docs/EMAIL.md) for SMTP/DNS/compliance setup,
[docs/BACKUP.md](docs/BACKUP.md) for the passphrase-sealed credential backup and the `.env.local` pre-fill, and
[docs/EXPERT_PLAYBOOK.md](docs/EXPERT_PLAYBOOK.md) for the writing, pricing and platform standard the
generator and assistant are held to.

---

## Known limitations (deliberately not faked)

- **API credentials are yours to provide.** Without a connected account, jobs are recorded as
  `MANUAL ACTION REQUIRED` — they are not silently skipped and never marked published.
- **Approval-gated APIs** (Pinterest standard access, Google Business Profile, LinkedIn Community
  Management, Hashnode publishing, paid X tiers) can only work after the provider grants access. The UI
  shows the exact API error if access is missing.
- **Images that need a public URL** (Blogger, Ghost covers, DEV.to covers, Google posts, Hashnode covers)
  require `PUBLIC_BASE_URL`; otherwise text-only publishing happens and the log says so.
- **YouTube Shorts needs video.** Install `ffmpeg` (or set `FFMPEG_PATH`) to render a 12s vertical clip from
  a poster, or upload an MP4 to the campaign. Without either, the job fails with an explicit message.
- **Engagement metrics** (impressions, likes, reach) are not returned by these APIs; the analytics screen
  marks them unavailable rather than showing zeros.
- **No platform-rule bypass.** CAPTCHA/login bypass, proxy rotation, identity spoofing and scraping are not
  implemented anywhere. When a platform blocks or gates something, ROYALWEB reports it and offers the manual
  package instead.
- **Group C platforms** are never automated — no browser automation, no login bypass, no CAPTCHA solving.
- **Email is sent from your address, not a fabricated one.** There is no virtual mailbox, no spoofed sender
  and no throwaway identity. You supply SMTP credentials for a mailbox on your own domain; the app enforces
  an opt-out route and permanent suppression.
- **Platform marks are not official logos.** Each platform is shown with an original letter mark in its
  brand colour (`PlatformMark.tsx`) to avoid shipping third-party trademark assets; swap in licensed logos
  if you have permission.

---

## License

Proprietary — built for ROYALWEB. Use and modify within the business that owns this repository.
