# Automation, alerts and multi-client workspaces

This page covers the hands-off layer: what runs without anyone opening a tab, what it will tell you when
it breaks, and where the edges are. Everything described here is real code with real side effects — no
simulated success. The acceptance suite proves each capability (T36–T44, see [ACCEPTANCE.md](ACCEPTANCE.md)).

---

## 1. Background supervision (`src/lib/monitor.ts`)

Two independent timers start with the server (`src/instrumentation.ts`):

| Timer | Interval | Responsibility |
| --- | --- | --- |
| publishing worker | 20 s | claims due jobs, publishes, retries with backoff, records every attempt |
| supervisor | 60 s | heartbeat watch, token expiry, scheduled snapshots, feed polling, evergreen recycling |

The supervisor records `worker_heartbeats` rows. If the most recent heartbeat is older than **120 s** it
raises `worker_dead` once per hour (deduplicated in `alert_state`, so a flapping worker cannot spam you).

**Honest limitation:** the supervisor lives in the same process as the worker. It catches a *hung or
disabled* worker while the HTTP server is still serving. A whole-process crash (OOM kill, container exit,
`systemctl` stop) cannot alert you from inside — point an external monitor at `GET /api/health` for that
case. It returns `db=ok` and the platform count, and needs no authentication.

Run the supervisor on demand (admin only):

```bash
curl -X POST http://localhost:3000/api/alerts/check -H 'x-royalweb-request: 1' -b cookies.txt
```

---

## 2. External alerts (`src/lib/alerts.ts`, `Settings → Automation & Alerts`)

| Code | Fires when | Dedupe |
| --- | --- | --- |
| `worker_dead` | heartbeat older than 120 s | 60 min |
| `token_expired` | a stored OAuth/API token passed `token_expires_at` | 24 h |
| `retries_exhausted` | a job used every attempt and still failed | 60 min |
| `snapshot_failed` | a scheduled snapshot could not be written | 6 h |
| `rss_failed` | a feed poll failed | 6 h |
| `test` | the **Send test alert** button | none |

Channels, all optional and combinable — configure at least two and a failure still reaches you when one
provider is down:

- **Telegram** — bot token (from `@BotFather`) + chat ID. Stored encrypted with the installation key.
- **Email** — goes through the workspace's own verified SMTP identity, so alerts work even if your
  mailbox is on another provider.
- **Webhook** — any HTTPS endpoint; receives `{code, title, detail, severity, workspaceId, at}`.

Each attempt is written to `alert_events` with the channel, HTTP result or SMTP message, and a `delivered`
flag. A failed channel does **not** mark the alert delivered; the event list in the UI shows exactly which
channel failed and why.

For self-hosted testing you can point Telegram at a local double with `ROYALWEB_TELEGRAM_API_BASE`
(the acceptance suite does this to prove the request is really sent).

---

## 3. Full-database snapshots (`src/lib/snapshot.ts`)

A snapshot is the *whole* database — campaigns, generated content, publishing jobs, published history,
analytics rows and the permanent email suppression list — not just credentials. Credentials travel inside
the database file too, but they were already encrypted per row.

- Engine: SQLite `VACUUM INTO` (a consistent copy while the app keeps running) → encrypted with
  **scrypt(N=32768,r=8,p=1) → AES-256-GCM**, header authenticated as AAD. Same crypto as the credential
  backup, so one passphrase discipline covers both.
- Location: `data/snapshots/royalweb-snapshot-<timestamp>-<trigger>.rwbak` (`ROYALWEB_DATA_DIR` respected).
- Schedule: **off / daily / weekly**, checked by the supervisor. `manual` snapshots are never pruned;
  scheduled ones keep the newest `retention` (default 7).
- Download: `GET /api/snapshots/<id>` streams the sealed file.

### Restoring

Restoring swaps the live database file, so it is a deliberate CLI operation performed with the app
**stopped**:

```bash
npm run db:restore -- data/snapshots/royalweb-snapshot-....rwbak
# passphrase from ROYALWEB_SNAPSHOT_PASSPHRASE, or prompted
```

The command decrypts to `royalweb.db.restored` and prints the three swap steps. It never touches the live
file, so a wrong passphrase costs nothing. T39 in the acceptance suite runs this end to end and checks the
restored bytes begin with `SQLite format 3`.

---

## 4. RSS / blog ingestion (`src/lib/rss.ts`)

Add a feed URL in **Automation & Alerts → RSS / blog ingestion**. Each new article becomes a campaign with
**all 25 platform drafts** and is left in `draft` state for approval — ingestion never approves or
schedules anything by itself.

- Polling: every supervisor tick, at most 10 new items per feed per poll, deduplicated by GUID/link in
  `rss_items`, so a flapping feed cannot flood the calendar.
- The article's lead image (RSS `enclosure`, `media:content` or the first `<img>`) is downloaded into the
  media library with real width/height/hash metrics. If no image exists, the campaign is created without
  one and the item records why.
- SSRF guard: feed and image URLs are resolved and private/loopback/link-local addresses are refused,
  with redirects re-checked. `ROYALWEB_ALLOW_PRIVATE_FETCH=1` relaxes this for local testing only.
- Every poll result — items seen, drafted, skipped, error text — is stored on the feed row and shown in the
  UI.

---

## 5. Evergreen recycling (`src/lib/evergreen.ts`)

Set a window of **0 (off) to 365 days** on a completed campaign, or recycle immediately:

```bash
POST /api/campaigns/<id>/recycle   {"windowDays": 75}   # set the window
POST /api/campaigns/<id>/recycle   {"recycleNow": true} # clone now
```

- The clone is a new **draft** campaign (`recycled_from` points at the source, platform drafts are never
  auto-approved).
- Copy is varied, not repeated: with a real AI provider configured the text is regenerated; without one,
  deterministic opener/angle variation is applied and labelled `generator='recycled'`,
  `model='royalweb-recycle-v1'`. There is no pretence that a template variation is fresh AI writing.
- The poster is **copied**, not shared: deleting one campaign must never break the other.
- After recycling, the source window is set to 0 so it cannot be recycled twice by accident.

---

## 6. Email warm-up and IMAP reply detection (`src/lib/email/warmup.ts`, `src/lib/email/imap.ts`)

**Warm-up** protects a new sending domain: the daily cap starts at `ramp_start` (default 5), grows by
`ramp_increment` (default 3) per day and stops at `ramp_max` (default 50). Sends are counted in
`email_send_daily` and the slot is reserved *before* the SMTP conversation and released if the send fails,
so a crash mid-send cannot burn quota. When the cap is reached the API answers HTTP **429
`daily_limit`** — the message is not silently dropped. Turning warm-up off means "limit = ramp_max", not
"unlimited".

**IMAP** polls the mailbox of the same identity and looks for replies from leads you emailed:

- Uses `BODY.PEEK` so nothing is marked read, and only the recent window is fetched.
- A reply is deduplicated on (workspace, sender, subject) in `email_replies`.
- Any queued `follow_up` message to that lead is set to `status='paused'`, and sending a new follow-up to
  that address is refused with HTTP **409 `reply_paused`**. You still see the lead; the automation simply
  stops talking.
- Only implicit TLS (993/995) is supported for real providers; other ports are treated as plain sockets for
  local relays and test doubles. STARTTLS upgrade is not implemented — use 993.

---

## 7. Multi-brand workspaces (`src/lib/workspace.ts`)

A workspace owns: business identity and brand settings, **connected platform accounts**, campaigns,
content calendar, media library, email sender identity (SMTP), warm-up state, alert configuration and
snapshot schedule. The operator account, audit log, diagnostics and installation secrets stay shared.

- Switch with the selector in the sidebar (`PATCH /api/workspaces {activeId}`), create with
  `POST /api/workspaces {name}`, archive with `PATCH {archiveId}`.
- Every scoped query filters on `auth.workspaceId`; workspace rows are returned by
  `GET /api/workspaces` with per-workspace counts so the switcher shows what each client holds.
- Legacy rows created before workspaces existed were backfilled to the first workspace by migration v6;
  credentials seeded from `.env.local` land in the active workspace, never in a shared bucket.
- Deleting is not offered — archiving keeps history and audit records intact.

---

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROYALWEB_TELEGRAM_API_BASE` | `https://api.telegram.org` | override for a local Telegram double |
| `ROYALWEB_ALLOW_PRIVATE_FETCH` | unset | allow feeds/images on private addresses (local testing only) |
| `ROYALWEB_SNAPSHOT_PASSPHRASE` | unset | passphrase for `npm run db:restore` |
| `ROYALWEB_DATA_DIR` | `./data` | where the database, uploads and snapshots live |

---

## What is deliberately *not* automatic

- Nothing is published to a platform without an approved draft and a connected account.
- RSS and recycling produce drafts only; a human approves.
- A reply pauses automation but does not send, archive or delete anything.
- Snapshots are never restored automatically — swapping a live SQLite file needs an operator decision.
