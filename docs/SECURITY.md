# Security model

## Threat model

| Asset | Threat | Mitigation |
|---|---|---|
| Admin account | credential stuffing, brute force | scrypt hashing, 8-attempt lockout (15 min), IP + account rate limits, audit log |
| Session | cookie theft / fixation | 256-bit random token, stored only as SHA-256 hash, HttpOnly + SameSite=Lax, 12h TTL, revocable server-side |
| Platform credentials | database leak, XSS, client-side exposure | AES-256-GCM at rest, decrypted only in the publishing worker, never serialized to the client, never in localStorage/bundles |
| Publishing actions | CSRF, unauthorised posting | Origin + Sec-Fetch-Site validation, required custom header, session auth on every API route, explicit content approval |
| Business contact data | accidental publication | `publicContactVisible` gate applied in every adapter and in manual packages |
| Media | path traversal, overwrite | UUID filenames, resolved paths confined to `data/uploads`, originals written with `wx` (no overwrite) |
| Public media URLs | enumeration | HMAC signature over `mediaId:preset` with the master key |
| Abuse | upload/API flooding | fixed-window rate limits persisted in SQLite |

## Implemented controls

**Authentication**
- Passwords: scrypt N=16384, r=8, p=1, 64-byte output, 16-byte random salt, timing-safe comparison.
- Failed login increments a counter; at 8 failures the account locks for 15 minutes. Login attempts are
  rate-limited per IP (12/15min) and per account (8/15min).
- First-run setup is allowed only while zero users exist and is rate-limited.

**Sessions**
- Cookie `rw_session`: HttpOnly, SameSite=Lax, `Secure` in production, 12-hour absolute lifetime.
- Only SHA-256 hashes are stored; revocation is immediate (`revoke others`, `sign out all`, password change).
- Session rows record IP and user-agent for review in Security → Sessions.

**CSRF**
- Mutating requests require `x-royalweb-request: 1` (a header HTML forms cannot set cross-origin) **and**
  same-origin `Origin`/`Sec-Fetch-Site` validation. Combined with SameSite=Lax cookies.

**Secrets**
- Platform tokens, AI keys and OAuth client secrets are encrypted with AES-256-GCM (random 96-bit IV,
  authentication tag) using a 32-byte master key from `ROYALWEB_ENCRYPTION_KEY` or a 0600 key file.
- API responses expose only masked status (`configured: true/false`), never values.
- The encryption key never enters the database, the repo, or any response body.

**Authorisation**
- Every data query is scoped by `user_id`; a second admin cannot read another admin's campaigns.
- Publishing requires: approved content row, campaign not paused/cancelled, global pause off, platform
  enabled, account status `connected`. Each condition is re-checked inside the worker at publish time.

**Publishing integrity**
- Unique idempotency key per (campaign, platform, scheduled time); jobs are claimed with a conditional UPDATE
  so concurrent workers cannot double-publish.
- Content hash + configurable duplicate window blocks identical copy from being republished.
- Automatic recovery of jobs stuck in `processing` after 10 minutes.
- Exponential backoff (2/8/32 min, max 3 attempts); permission/auth errors are never retried endlessly.

**Input handling**
- All request bodies validated with Zod schemas (length caps, URL format, enums).
- Media uploads restricted by MIME/extension and size (25 MB images, 200 MB video), decoded with Sharp
  (`failOn: 'none'`) before use.
- Errors are logged server-side; clients receive generic messages for unexpected failures.

**Privacy**
- Personal email/phone are excluded from all generated content, manual packages and platform API calls
  unless public contact is explicitly enabled.
- No analytics/tracking scripts, no third-party fonts or CDNs are loaded at runtime.
- Uploaded media and the database live only on your server (`data/`), not in this repository.

## Operational checklist

- [ ] Set a strong `ROYALWEB_ADMIN_PASSWORD` and change it after first login (Security → Change password).
- [ ] Set `ROYALWEB_ENCRYPTION_KEY` and store a copy in your password manager / secrets manager.
- [ ] Serve only over HTTPS; the session cookie is `Secure` in production.
- [ ] Set `ROYALWEB_WORKER_SECRET` if the tick endpoint is exposed to the internet.
- [ ] Restrict `/api/worker/tick` at the proxy to your scheduler's IP if possible.
- [ ] Keep `data/` out of backups that are not encrypted.
- [ ] Review Security → Audit log after any suspicious activity.
- [ ] Rotate platform tokens periodically; disconnect unused accounts (this cancels their pending jobs).
- [ ] Keep dependencies updated (`npm audit`, `npm update`).

## What the app deliberately does not do

- Store social-media passwords (only OAuth tokens / app-specific passwords you generate).
- Automate browsers, bypass logins/CAPTCHAs, rotate proxies, or spoof identity.
- Scrape platforms or use unofficial private endpoints.
- Publish to accounts you have not explicitly connected and approved content for.
