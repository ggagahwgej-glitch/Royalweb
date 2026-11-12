# Backups, restores and first-run pre-fill

Two features exist for one reason: after a database reset, a reinstall or a move
to another server you should not have to retype 25 sets of platform credentials.

- **Encrypted backup** — one passphrase-protected file containing every saved
  secret, every connected account with its tokens, and the opt-out list.
- **`.env.local` pre-fill** — the values you already keep in the environment are
  written into the encrypted store automatically on first run.

Both are in **Settings → Backup & onboarding**.

---

## 1. Encrypted backup

### What is inside

| Item | Detail |
|---|---|
| Application secrets | AI API key + base URL, OAuth client IDs/secrets (Google, Pinterest, LinkedIn, X, Slack, Tumblr), SMTP host/port/user/password, sender identity (from, reply-to, postal address, unsubscribe URL) |
| Connected accounts | One entry per platform: account label, external id, credential payload (WordPress app password, Telegram bot token, Bluesky app password, Mastodon token, OAuth access/refresh tokens…), scopes, token expiry, last verification time |
| Opt-out list | Every suppressed email address with its reason and date |

Not included: campaigns, posters, generated copy, publishing history, users and
password hashes. Those are database content, not configuration — keep a copy of
`data/royalweb.db` for them (it is already encrypted at rest per column, but the
file itself should be protected like any database backup).

### How it is protected

```
passphrase ──scrypt(N=32768, r=8, p=1, 16-byte salt)──▶ 256-bit key
                                                          │
payload (JSON) ────────────────────────────────▶ AES-256-GCM ─▶ file
                                             header bound as AAD
```

- The passphrase is **never stored** — not in the database, not in the file.
- The server's master key is deliberately *not* used. A backup encrypted with a
  machine-local key could never be opened after a reinstall, which defeats the
  point.
- The KDF parameters, cipher name, version and salt are authenticated (AAD), so
  editing the file — including downgrading the parameters — is detected on open.
- A wrong passphrase and a tampered file produce the same error on purpose:
  `Wrong passphrase, or the file has been modified since it was exported.`
- The download is sent with `Cache-Control: no-store` and never touches the
  front-end bundle, localStorage or the audit log.

### Rules

- **Admin only.** Both endpoints reject non-admin sessions (`403 admin_only`).
- **Rate limited.** 10 exports and 10 imports per hour per user.
- **Audited.** `backup.exported` and `backup.imported` record counts, platform
  ids and key *names*. Values are never written to the audit log.
- **Minimum passphrase length** is 12 characters. Use a generated one
  (`openssl rand -base64 24`) and store it in your password manager, separately
  from the file.

### Restoring

1. **Settings → Backup & onboarding → Restore from backup.**
2. Choose the `.json` file, enter the passphrase.
3. Pick a mode:
   - **Merge** (default) — adds and updates; never deletes an account, never
     removes an opt-out. Secrets in the file overwrite the stored value for the
     same key.
   - **Replace** — deletes this operator's connected accounts first, then
     restores exactly what the file contains. Requires typing `REPLACE`.
4. Read the report: how many secrets/accounts/opt-outs were restored, which
   platform ids were touched, and what was skipped (unknown platform, invalid
   credentials, account owned by another user, unknown secret key).

**Restored accounts are `unverified`.** A backup proves what was true when it
was taken, not that a token is still valid. Publishing only ever uses accounts
in the `connected` state, so press **Verify** (one click — nothing to retype) or
run **Diagnostics → Verify accounts**. Diagnostics raises an issue for every
unverified account and offers that repair as a single action.

### If you lose the passphrase

There is no recovery path. That is the design: the file has no second key. Your
options are the original sources — `.env.local` on the old machine, the platform
dashboards, or the provider's own app-password/authorisation screens.

---

## 2. `.env.local` pre-fill

Runs automatically **once**, when the first administrator is created (either by
the setup form or by `ROYALWEB_ADMIN_EMAIL` / `ROYALWEB_ADMIN_PASSWORD` on
boot). It can be re-run any time from the same screen.

### Application secrets

Any variable that the app already understands is copied into `app_secrets` with
`source='environment'`:

```
ROYALWEB_AI_API_KEY, ROYALWEB_AI_BASE_URL
ROYALWEB_SMTP_HOST, _PORT, _USER, _PASS
ROYALWEB_EMAIL_FROM, _FROM_NAME, _REPLY_TO, _POSTAL_ADDRESS, _UNSUBSCRIBE_URL
GOOGLE_CLIENT_ID/_SECRET, PINTEREST_*, LINKEDIN_*, X_*, SLACK_*, TUMBLR_*
```

**Environment values always win at runtime.** Seeding stores a copy so the
Settings screen shows the configuration honestly and so an export contains it;
it does not demote the environment from being the source of truth. Rotate a key
by changing the variable and restarting — the stored copy is updated on the next
pre-fill.

### Platform accounts

Two equivalent forms.

**One JSON object** — best when you are moving a whole setup:

```bash
ROYALWEB_CREDENTIALS='{
  "wordpress": {"siteUrl": "https://royalweb.in", "username": "editor", "appPassword": "abcd efgh ijkl mnop"},
  "telegram":  {"botToken": "123456:ABC…", "chatId": "-1001234567890"},
  "bluesky":   {"handle": "royalweb.bsky.social", "appPassword": "abcd-efgh-ijkl-mnop"}
}'
```

The keys inside each platform are exactly the fields shown in **Connect
account** (they are the adapter's `credentialFields`).

**One variable per field** — best for secrets managers and CI:

```bash
ROYALWEB_WORDPRESS_SITE_URL=https://royalweb.in
ROYALWEB_WORDPRESS_USERNAME=editor
ROYALWEB_WORDPRESS_APP_PASSWORD="abcd efgh ijkl mnop"
```

The variable name is `ROYALWEB_<PLATFORM>_<FIELD>`, uppercased with underscores
(`siteUrl` → `SITE_URL`, `appPassword` → `APP_PASSWORD`, `chatId` → `CHAT_ID`).
The compact form without underscores (`SITEURL`) is also accepted.

Optional per platform:

| Variable | Purpose |
|---|---|
| `ROYALWEB_<PLATFORM>_ACCOUNT_NAME` | Label the account yourself. Otherwise the site host, handle or username is used. |
| `ROYALWEB_<PLATFORM>_TOKEN_EXPIRES_AT` | ISO timestamp for a pre-issued OAuth token. |
| `ROYALWEB_DISABLE_ENV_SEED=1` | Turn pre-filling off completely. |

A platform is only imported when **every required field** is present. Partial
sets are listed as *incomplete* with the missing field labels and are not
written — a half-configured account would be a lie you only discover at publish
time.

### What you get, and what you don't

- Accounts land as **`unverified`**, never `connected`. Environment variables
  prove configuration, not that the platform still accepts the token.
- The pre-fill is **idempotent**: re-running updates the same rows, and an
  account that is already `connected` is left alone.
- Each run is recorded in `env_seed_runs` (trigger, counts, skipped entries) and
  audited as `env.seeded`, so "where did this connection come from?" always has
  an answer.

---

## Verifying both features

The acceptance suite covers them (`T31a`, `T31b`, `T32`, `T33`, `T34`, `T35`) but
needs the server started with a test environment, because `.env.local` is read by
the server process, not by the test runner:

```bash
npm run db:reset
ROYALWEB_CREDENTIALS='{"wordpress":{"siteUrl":"http://127.0.0.1:3999","username":"env-editor","appPassword":"env-app-password"}}' \
ROYALWEB_SMTP_HOST=127.0.0.1 ROYALWEB_SMTP_PORT=2525 \
ROYALWEB_SMTP_USER=outreach@royalweb.test ROYALWEB_SMTP_PASS=app-password \
  npm start

TEST_EMAIL=admin@royalweb.local TEST_PASSWORD='Royalweb-Acceptance-2026' npm run acceptance
```

Without that environment the five checks are reported as **skipped** — never as
passed.

---

## Operational advice

- Keep at least two backups: one offline copy and one in a password manager or
  secrets vault. Both need the passphrase to be useful, so store it separately.
- Re-export after rotating credentials — an old file restores old tokens.
- Delete old exports. Every file is a complete key to your publishing identity.
- If a file might have leaked: revoke the platform tokens at the source
  (WordPress application passwords, bot tokens, OAuth app authorisations). The
  encryption is strong, but rotation is the only response that ends the risk.
