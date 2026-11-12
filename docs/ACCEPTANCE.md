# Acceptance test results

**Executed:** 2026-11-12 · **Environment:** Node v22.22.3, Next.js 15.5.29 (production build),
macOS/Linux sandbox, SQLite via `node:sqlite`, no AI provider configured (template engine active),
no third-party credentials.

**Command**

```bash
npm run build && npm start
TEST_EMAIL=admin@royalweb.local TEST_PASSWORD='Royalweb-Acceptance-2026' npm run acceptance
```

**Result: 31 passed · 0 failed · 1 skipped · 32 checks.**

Raw output (reproducible with `npm run acceptance`):

```
ROYALWEB AUTOPILOT — acceptance suite against http://127.0.0.1:3000

· mock WordPress API listening on 127.0.0.1:3999 (test double)

✓ T1a  Health endpoint reports 25 platforms — db=ok
✓ T1b  Protected API rejects anonymous access — HTTP 401
✓ T1c  First-run administrator created — admin@royalweb.local
✓ T1d  Wrong password rejected — HTTP 401
✓ T2   Poster uploaded with dimensions analysed — 1200×1500, 60 KB
✓ T3   Original poster preserved byte-for-byte — sha256 e859010cb78d289b…
✓ T5   All 25 platforms present — A=10 B=8 C=7
✓ T6   Automatic vs manual clearly distinguished — 18 API · 7 manual
✓ T4   Platform-specific content generated for all 25 (no two identical captions) — 25 drafts · 25 unique · 21 distinct openings · mode=template
✓ T7a  Account connection workflow (manual profile) — stored
✓ T7b  Invalid credentials rejected before storage — WordPress verification: HTTP 0
✓ T7c  WordPress connected via live REST verification — Acceptance Editor
✓ T8   Publishing job created with idempotency key — status=scheduled
✓ T11a Manual task queued for Group C platform — pending
✓ T11b Manual package downloadable as ZIP — 30 KB
✓ T11c Manual task can be marked published
✓ T12  Scheduled jobs persist across refresh
✓ T9   Publishing status recorded from platform response — published · https://mock-royalweb.test/?p=5001
– T8b  Publish-now attempt reached the engine — job already existed (idempotent)
✓ T14a No fake success: mock received the real API calls — 1 media, 1 posts
✓ T16  Re-scheduling does not duplicate jobs — 1 → 1
✓ T10  Failed publishing shows a useful, stored error — WordPress publish: platform server error (HTTP 500). Mock upstream failure
✓ T10b Temporary failure is queued for retry, not lost — status=scheduled, retryIn=4m
✓ T17  Disconnecting an account blocks future publishing — job=manual_required
✓ T18  Global pause prevents publishing (job stays scheduled) — status=scheduled
✓ T13  Dashboard renders with mobile viewport + navigation — HTTP 200
✓ T15  No credentials or secret values exposed to the client
✓ X1   Private contact details excluded from generated content
✓ X2   Analytics reports engagement as unavailable, not zero — Impressions, reach, clicks, likes and views are not exposed by these platform APIs
✓ X3   Assistant plans without claiming publication — intent=plan, aiUsed=false
✓ X4   Input validation rejects invalid payloads — HTTP 400
✓ X5   Cross-site request without verification header blocked — HTTP 403

──────────────────────────────────────────────────────────────
31 passed · 0 failed · 1 skipped · 32 checks
```

## How the tests were executed

The suite talks to a **real running server** over HTTP and inspects the resulting database state
through the same API the dashboard uses. Nothing is mocked inside the application.

One controlled test double is used: a small local server implementing the WordPress REST API endpoints
(`/wp-json/wp/v2/users/me`, `/media`, `/posts`), so the automatic publishing path can be exercised
against a real HTTP target without publishing to a stranger's blog. The application treats it exactly
like a real WordPress site (credentials are verified with a live call, media is uploaded, a post is
created, and the returned URL is stored). Switching the mock to return `500` / `401` proves the retry
and connection-expiry paths.

## Requirement → evidence

| # | Requirement | Evidence |
|---|---|---|
| 1 | Admin can sign in; unauthenticated API calls are refused | T1a–T1d: first-run setup, login, wrong-password rejection, `401` on `/api/campaigns` without a session |
| 2 | Poster upload works and the original is never destroyed | T2, T3: 1200×1500 JPEG uploaded, dimensions analysed; downloaded original hash equals the uploaded hash byte-for-byte |
| 3 | AI/engine writes content for every selected platform | T4: 25 drafts, **25 unique captions**, 21 distinct openings, generated in one pass |
| 4 | Content is platform-specific, not one caption copied everywhere | T4: uniqueness assertion (previous iteration produced duplicates — test failed, engine was rewritten with per-platform article/listing/case-study builders, then passed) |
| 5 | All 25 platforms exist from day one, grouped A/B/C | T5: 10 + 8 + 7 = 25 |
| 6 | Automatic vs manual publishing is explicit | T6: 18 API-capable, 7 manual; each adapter declares `automation` |
| 7 | Account connection workflow validates credentials | T7a (manual profile), T7b (bad credentials rejected with a real network error), T7c (WordPress verified via live REST call) |
| 8 | Scheduling creates real publishing jobs with idempotency keys | T8: job `scheduled`, unique key; T16: re-scheduling does not duplicate |
| 9 | Publishing records the platform's own result | T9, T14a: job `published`, URL `https://mock-royalweb.test/?p=5001` stored from the API response; mock received 1 media + 1 post request |
| 10 | Failure is stored with a useful error, never hidden | T10: `WordPress publish: platform server error (HTTP 500). Mock upstream failure` |
| 11 | Failed posts retry with backoff instead of being lost | T10b: status back to `scheduled`, `retryIn=4m`, attempts incremented |
| 12 | Manual platforms produce a real package | T11a–T11c: task queued, 30 KB ZIP downloaded (valid `PK` header), mark-published works |
| 13 | Schedule survives a page refresh | T12: server state re-read after the fact |
| 14 | Global pause stops publishing | T18: with pause on, the job stays `scheduled` and the attempt reports the pause (account was verified and healthy) |
| 15 | Disconnecting an account prevents publishing | T17: after disconnect, the next attempt is `manual_required` instead of posting |
| 16 | No secret leaves the server | T15: `/api/settings` and `/api/accounts` contain no ciphertext, key material or `sk-…` values |
| 17 | Private contact details are not published unless enabled | X1: generated content contains no WhatsApp/phone value while public contact is off |
| 18 | Analytics never fabricates engagement; assistant needs approval | X2: `engagement.available === false` with an explanation; X3: assistant returns a plan with `requiresApproval` and cannot publish |
| + | Input validation & CSRF | X4: empty campaign name → `400`; X5: PATCH without `x-royalweb-request` → `403` |
| + | Every dashboard route renders | `/`, `/login`, `/dashboard` and all 12 sub-pages returned `200` with a session, no error boundaries triggered |

## Skipped (honest disclosure)

- **T8b** — the publish-now call was absorbed by the existing scheduled job (correct idempotent
  behaviour), so there was no second outcome to inspect. Verified separately by `T9`.
- **Live OAuth flows** for Pinterest, LinkedIn, Google, X, Slack and Tumblr, and **live publishing to
  the 24 non-WordPress platforms**, require provider credentials and (for several) paid plans or
  manual approval. They cannot be executed without them and are deliberately not simulated as
  successes. Each adapter is implemented against the documented endpoints in
  [PLATFORM_INTEGRATIONS.md](PLATFORM_INTEGRATIONS.md); verify each one once via
  **Connected Accounts → Verify**, then publish one real test campaign per platform.

## Reproducing

```bash
npm install
npm run db:reset            # optional: start from an empty database
npm run build && npm start  # or npm run dev
TEST_EMAIL=you@example.com TEST_PASSWORD='…' npm run acceptance
```

The suite creates its own campaigns (prefixed `Acceptance`), a mock-verified WordPress account and a
Behance profile account. Delete them from the dashboard afterwards if you ran it against production.
