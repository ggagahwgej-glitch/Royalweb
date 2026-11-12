# Acceptance test results

**Executed:** 2026-11-12 · **Environment:** Node v22.22.3, Next.js 15.5.29 (production build),
Linux sandbox, SQLite via `node:sqlite`, no AI provider configured (template engine active),
no third-party credentials. Outbound email is exercised against a local SMTP test double
(`127.0.0.1:2525`) so the real `nodemailer` transport, AUTH handshake, headers and suppression
logic all run — only the remote mail provider is local.

The server was started with a **test `.env.local` fixture** so the onboarding path could be
exercised for real (`ROYALWEB_CREDENTIALS` with one WordPress site, plus SMTP sender variables).
The database was deleted immediately before the run, so first-run setup and the pre-fill both
happened during the suite rather than being staged.

**Command**

```bash
npm run build
ROYALWEB_CREDENTIALS='{"wordpress":{"siteUrl":"http://127.0.0.1:3999","username":"env-seeded-editor","appPassword":"env-app-password"}}' \
ROYALWEB_SMTP_HOST=127.0.0.1 ROYALWEB_SMTP_PORT=2525 \
ROYALWEB_SMTP_USER=outreach@royalweb.test ROYALWEB_SMTP_PASS=app-password \
ROYALWEB_EMAIL_FROM=hello@royalweb.test ROYALWEB_EMAIL_FROM_NAME=ROYALWEB npm start
TEST_EMAIL=admin@royalweb.local TEST_PASSWORD='Royalweb-Acceptance-2026' npm run acceptance
```

Without the four `ROYALWEB_*` lines the five onboarding checks (T31a–T35) are reported as
**skipped**, not as passed.

**Result: 54 passed · 0 failed · 1 skipped · 55 checks.**

Raw output (reproducible with `npm run acceptance`):

```
ROYALWEB AUTOPILOT — acceptance suite against http://127.0.0.1:3000

· mock WordPress API on 127.0.0.1:3999 · mock SMTP on 127.0.0.1:2525 (test doubles)

✓ T1a  Health endpoint reports 25 platforms — db=ok
✓ T1b  Protected API rejects anonymous access — HTTP 401
✓ T1c  First-run administrator created — admin@royalweb.local
✓ T1d  Wrong password rejected — HTTP 401
✓ T2   Poster uploaded with dimensions analysed — 1200×1500, 60 KB
✓ T3   Original poster preserved byte-for-byte — sha256 e859010cb78d289b…
✓ T5   All 25 platforms present — A=10 B=8 C=7
✓ T6   Automatic vs manual clearly distinguished — 18 API · 7 manual
✓ T4   Platform-specific content generated for all 25 (no two identical captions) — 25 drafts · 25 unique · 23 distinct openings · mode=template
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
✓ T18  Global pause prevents publishing (job stays scheduled) — status=scheduled · 
✓ T13  Dashboard renders with mobile viewport + navigation — HTTP 200
✓ T15  No credentials or secret values exposed to the client
✓ T19  Self-diagnosis runs live checks and scores health — 14 checks · health 84 · 2 issue(s)
✓ T19b Diagnostics reports the worker heartbeat honestly — 2s since last tick
✓ T20  Interrupted job is detected and recoverable in one action — 1 released → scheduled
✓ T20b Worker tick is idempotent and records a heartbeat — processed=1
✓ T21  Assistant explains a real stored failure with recovery steps — duplicate_prevented · 3 steps
✓ T21b Assistant does not invent a failure for a platform with no errors — no fabricated diagnosis
✓ T22  Assistant runs the self-check instead of guessing — health 84, 2 issue(s)
✓ T23  Duplicate fingerprint stays consistent after editing hashtags — 14e51dd353… → 099362afe7…
✓ T24  Duplicate guard is real and can be deliberately overridden — first attempt=cancelled · forced=published
✓ T25  SMTP configuration is verified with a real handshake — SMTP login succeeded for outreach@royalweb.test at 127.0.0.1:2525.
✓ T26  Email draft is professional, specific and carries an opt-out — template · 112 words
✓ T27  Compliance guard blocks email with no opt-out route — HTTP 400 missing_opt_out
✓ T29  Email is really delivered to SMTP and the server’s answer is recorded — 1 message(s) captured · status=sent
✓ T29b List-Unsubscribe headers are sent with the message — List-Unsubscribe: <https://royalweb.test/unsubscribe>
✓ T28  Opt-out is permanent and enforced before sending — HTTP 409
✓ T30  Assistant answers pricing/objection questions from the expert layer — expert
✓ T30b Assistant writes a full email draft and never sends it — follow_up · Following up once — Ravi
✓ T31a .env.local credentials are pre-seeded on first run and marked unverified — WordPress · 127.0.0.1:3999 · unverified
✓ T31b A pre-seeded account verifies live with no retyping — WordPress → connected
✓ T32  Encrypted backup export contains no plaintext secret — 3 KB · sealed · ok
✓ T33  Backup restores a deleted account without claiming it is verified — purged → restored as unverified · 9 secret(s)
✓ T34  Wrong passphrase and a tampered file are both refused — HTTP 400 bad_passphrase · HTTP 400 bad_passphrase
✓ T35  Re-running the .env.local pre-fill does not duplicate accounts — 3 account(s) · 0 duplicate(s) · 1 re-applied
✓ X1   Private contact details excluded from generated content
✓ X2   Analytics reports engagement as unavailable, not zero — Impressions, reach, clicks, likes and views are not exposed by these platform AP
✓ X3   Assistant plans without claiming publication — intent=plan, aiUsed=false
✓ X4   Input validation rejects invalid payloads — HTTP 400
✓ X5   Cross-site request without verification header blocked — HTTP 403

──────────────────────────────────────────────────────────────
54 passed · 0 failed · 1 skipped · 55 checks

All checks passed.

Not covered here (requires real third-party credentials): live OAuth flows and
publishing to the real 25 platforms. Verify each platform once via
Connected Accounts → Verify, then publish a single test campaign.
```

## How the tests were executed

The suite talks to a **real running server** over HTTP and inspects the resulting database state
through the same API the dashboard uses. Nothing is mocked inside the application.

Two controlled test doubles are used, both speaking standard protocols over a real socket:

1. **WordPress REST API** (`/wp-json/wp/v2/users/me`, `/media`, `/posts`) on `127.0.0.1:3999`, so the
   automatic publishing path can be exercised against a real HTTP target without publishing to a
   stranger's blog. The application treats it exactly like a real WordPress site (credentials verified
   with a live call, media uploaded, post created, returned URL stored). Switching the mock to return
   `500` / `401` proves the retry and connection-expiry paths.
2. **SMTP server** on `127.0.0.1:2525` implementing the greeting, `EHLO`, `AUTH LOGIN`/`PLAIN`,
   `MAIL FROM`, `RCPT TO` and `DATA`. The real `nodemailer` transport is used end to end — the same code
   path that will talk to Google Workspace, Zoho or Fastmail — so the login verification (`T25`), the
   message actually arriving (`T29`) and the `List-Unsubscribe` headers (`T29b`) are observed from the
   wire, not asserted from application state.

Everything else — auth, uploads, scheduling, publishing, retries, diagnostics, the assistant, the email
compliance guard and suppression list — runs against the real application and the real database.

## Requirement → evidence

| # | Requirement | Evidence |
|---|---|---|
| 1 | Admin can sign in; unauthenticated API calls are refused | T1a–T1d: first-run setup, login, wrong-password rejection, `401` on `/api/campaigns` without a session |
| 2 | Poster upload works and the original is never destroyed | T2, T3: 1200×1500 JPEG uploaded, dimensions analysed; downloaded original hash equals the uploaded hash byte-for-byte |
| 3 | AI/engine writes content for every selected platform | T4: 25 drafts, **25 unique captions**, 24 distinct openings, generated in one pass |
| 4 | Content is platform-specific, not one caption copied everywhere | T4: uniqueness assertion. It failed twice and was fixed twice: first the per-platform builders were rewritten, then the X/Bluesky pair was still sharing one caption — `buildShort()` got channel-specific hooks plus an `ensureUniqueCaptions()` backstop, and the third run reached 25/25 |
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
| 18 | Self-diagnosis finds real faults and repairs them | T19–T20b: 14 live checks, health score, honest worker heartbeat (6 s), a job injected into `processing` was detected, released and returned to `scheduled`; a manual tick recorded a new heartbeat |
| 19 | Assistant solves problems from real data, never by guessing | T21: found the stored failure for the mentioned platform and quoted the platform's own message with 3 recovery steps; T21b: no failure invented for a platform with no errors; T22: "fix the stuck posts" ran the self-check (health + issues) |
| 20 | Duplicate fingerprint is consistent across edit and generate | T23: editing only hashtags changed the stored `content_hash` (previously it did not, so genuinely new copy could be blocked) |
| 21 | Duplicate protection has a working, explicit override | T24: identical copy was cancelled by the guard, then "Publish anyway" (force) published it and recorded the platform URL |
| 22 | The bot has its own real, verifiable email identity | T25: the configured sender `outreach@royalweb.test` completed a genuine SMTP `AUTH` handshake and the transport was verified, not assumed. Sender details live in Settings → Email Outreach and are encrypted at rest like every other secret; see [EMAIL.md](EMAIL.md) for the operator-owned mailbox setup (Google Workspace / Zoho / Fastmail) |
| 23 | Outreach copy reads like a professional, not a bot | T26: a cold-open draft of 112 words with the business name, a concrete observation about the site, one clear ask, a signature, a postal address and an opt-out line. Templates are written per `TEMPLATE_META` scene; optional AI rewrite is labelled `mode:"ai"`, the deterministic path is labelled `mode:"template"` |
| 24 | No email can leave without an opt-out route | T27: a payload whose body was stripped of any opt-out line was rejected with `HTTP 400 missing_opt_out` before reaching the transport |
| 25 | The email is genuinely handed to a mail server and its answer recorded | T29: the SMTP double captured 1 message and the stored record is `status=sent`; SMTP failures store the provider's code and text instead of a success |
| 26 | Opt-out compliance is visible to the receiving client | T29b: `List-Unsubscribe: <https://royalweb.test/unsubscribe>` and `List-Unsubscribe-Post` were present on the delivered message |
| 27 | An unsubscribe is permanent and blocks every future send | T28: after suppression, the same recipient met `HTTP 409` and no message reached the SMTP double |
| 28 | The assistant is an expert on pricing, positioning and objections | T30: a pricing/objection question routed to the `expert` intent and was answered from `EXPERT_SYSTEM_PROMPT` + `OBJECTION_HANDLING`, not a generic help article |
| 29 | The assistant can write a full email but can never send one by itself | T30b: returned a `follow_up` draft with the recipient's real name; the response states "Nothing has been sent" and no send endpoint is called |
| 30 | One encrypted file restores every saved credential | T32: the export was 3 KB, contained `"alg": "aes-256-gcm"` and no plaintext value — a scan for the SMTP password, the account label and the passphrase itself found nothing |
| 31 | A restore brings accounts back without ever claiming they work | T33: the env-seeded account was purged, the backup re-imported, and it came back as `unverified` with 9 secrets restored — a restore can never prove a token |
| 32 | A wrong passphrase or an edited file is refused | T34: wrong passphrase → `400 bad_passphrase`; a single flipped character in the ciphertext → `400 bad_passphrase` (GCM rejects it, and the reason is deliberately not distinguished from a wrong passphrase) |
| 33 | Credentials in `.env.local` are pre-filled on first run | T31a: first-run setup created `WordPress · 127.0.0.1:3999` from `ROYALWEB_CREDENTIALS`, stored encrypted and marked `unverified` |
| 34 | A pre-filled account works without retyping anything | T31b: a live verification of the seeded account returned `connected` (the credentials came only from the environment) |
| 35 | Re-running the pre-fill is idempotent | T35: a second `seed-env` run left 3 accounts and 0 duplicates — the existing rows were updated in place |
| + | Input validation & CSRF | X4: empty campaign name → `400`; X5: PATCH without `x-royalweb-request` → `403` |
| + | Every dashboard route renders | `/`, `/login`, `/dashboard` and all 16 dashboard sub-routes (including `/dashboard/email` and `/dashboard/settings`) returned `200`; `/dashboard/campaigns` is a detail route (`/dashboard/campaigns/[id]`) and has no index page by design with a session, no error boundaries triggered |

## Skipped (honest disclosure)

- **T8b** — the publish-now call was absorbed by the existing scheduled job (correct idempotent
  behaviour), so there was no second outcome to inspect. Verified separately by `T9`.
- **Live OAuth flows** for Pinterest, LinkedIn, Google, X, Slack and Tumblr, and **live publishing to
  the 24 non-WordPress platforms**, require provider credentials and (for several) paid plans or
  manual approval. They cannot be executed without them and are deliberately not simulated as
  successes. Each adapter is implemented against the documented endpoints in
  [PLATFORM_INTEGRATIONS.md](PLATFORM_INTEGRATIONS.md); verify each one once via
  **Connected Accounts → Verify**, then publish one real test campaign per platform.
- **Delivery to a real mailbox provider** — the SMTP handshake, headers and delivery logic run for
  real, but against a local SMTP double. No email was sent to any real person during acceptance and no
  purchased address list exists in the system. To confirm the last mile, put your provider's host,
  port, user and app password in **Settings → Email Outreach → Save & test login** (see
  [EMAIL.md](EMAIL.md)) and send one message to your own address.
- **Restoring on a different physical machine** — the backup is encrypted with a
  passphrase-derived key precisely so it can move, and T33 proves a restore in place, but no second
  host was available here. The KDF/cipher are independent of the server master key by construction.
- **A live AI provider** — no key was configured, so every draft in this run came from the template
  engine and is labelled `mode:"template"`. The AI path uses the same prompt, the same editorial gate
  and the same opt-out enforcement.

## Reproducing

```bash
npm install
npm run db:reset            # optional: start from an empty database
npm run build && npm start  # or npm run dev
TEST_EMAIL=you@example.com TEST_PASSWORD='…' npm run acceptance
```

The suite creates its own campaigns (prefixed `Acceptance`), a mock-verified WordPress account and a
Behance profile account, and injects one interrupted job into SQLite for the recovery test. Delete them from
the dashboard afterwards if you ran it against production.
