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

Full deployment and per-platform setup: [docs/SETUP.md](docs/SETUP.md).

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

**Last recorded run:** 31 passed · 0 failed · 1 skipped (32 checks) on Node 22 / Next 15.5.29 — full output,
including how each requirement was proven and what was *not* executed, is in
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

---

## Architecture

```
src/
  app/
    login, dashboard/*              14 dashboard sections (server-rendered shells)
    api/                            REST surface (auth, media, campaigns, jobs, accounts, oauth…)
  components/                       Design system + interactive views
  lib/
    db/                             node:sqlite connection, migrations, serializers
    auth.ts crypto.ts secrets.ts    Sessions, AES-256-GCM, scrypt, encrypted app secrets
    media/                          Sharp derivatives, signed public URLs, ffmpeg renderer
    platforms/                      25 adapters + shared HTTP/error classification
    ai/                             Provider-agnostic AI layer + template engine
    publishing/                     Job engine + in-process worker
    settings.ts time.ts validation.ts
  instrumentation.ts                Starts the publishing worker once per server process
scripts/                            db CLI, standalone worker, acceptance tests
docs/                               setup, integration matrix, security notes
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
- Rate limits: login (IP + account), uploads, generation, scheduling.
- Contact privacy: email/phone are excluded from all generated content unless you explicitly enable it.
- Audit trail for every administrative action; publishing log for every adapter call.

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and operational checklist.

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
- **Group C platforms** are never automated — no browser automation, no login bypass, no CAPTCHA solving.

---

## License

Proprietary — built for ROYALWEB. Use and modify within the business that owns this repository.
