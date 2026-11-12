# Quick-connect wizard

Connected Accounts opens with a wizard built for one thing: getting real credentials into the system
without reading platform documentation. It is the same encryption and the same live verification as the
single-account form — only the workflow is faster.

## How it works

1. **Pick a tier.** *Fastest to connect* shows the platforms that issue a usable token without an approval
   process (Telegram, WordPress, Bluesky, Discord, Mastodon, DEV.to, Hashnode, Ghost, Matrix). *OAuth /
   approval* shows the ones that need a developer app first. *Manual* shows the platforms where ROYALWEB
   only prepares copy. *All 25* is a single scrollable grid.
2. **Press `Get key ↗`.** Every platform has a direct deep link to the exact page that issues the
   credential — `t.me/BotFather`, `bsky.app/settings/app-passwords`, `discord.com/developers/applications`,
   `console.cloud.google.com/apis/credentials`, and so on — plus one line telling you what to click once you
   are there. Links open in a new tab and carry `rel="noopener"`.
3. **Paste.** Each credential field has its own *Paste* button (`navigator.clipboard.readText()`). If the
   browser blocks clipboard reads, the field is focused instead so Ctrl/Cmd+V works. Values are trimmed and
   never leave the browser until you save.
4. **Save & verify all.** One request verifies every filled platform against its real API
   (`POST /api/accounts/bulk`). The response is per-platform: `connected`, `failed` (with the platform's own
   error text) or `skipped` (field left empty). Failed rows stay populated in the grid so you can fix the one
   bad key; successful rows clear and appear in the account list above.

## Tiering rules

The tier is **derived from the adapter**, never stored separately:

| Tier | Rule | Examples |
| --- | --- | --- |
| `quick` | `automation !== 'manual'` and the adapter has no `oauth` block | Telegram, WordPress, Bluesky, Discord, Mastodon, DEV.to, Hashnode, Ghost, Matrix |
| `oauth` | the adapter defines an OAuth provider | Blogger, YouTube, Google Business, Pinterest, LinkedIn, X, Slack, Tumblr, Flickr |
| `manual` | `automation === 'manual'` | Quora, Behance, Dribbble, IndiaMART, Justdial, GoodFirms |

Because it is derived, the wizard can never advertise a platform as "5 minutes" while the publishing engine
knows it needs approval. The acceptance suite asserts the tier of every platform (T45).

## Empty platforms are not errors

Leaving 20 platforms blank is the expected path: the wizard shows `not connected` with no warning, no badge
count and no modal. Start with Telegram or WordPress, publish something real, then come back. Alerts only
fire for things that are actually configured and then break.

## API

```http
POST /api/accounts/bulk
{
  "entries": [
    { "platformId": "telegram", "credentials": { "botToken": "123:ABC", "chatId": "@mychannel" } },
    { "platformId": "wordpress", "credentials": { "siteUrl": "https://site.tld", "username": "editor", "appPassword": "abcd efgh" } }
  ]
}
```

Response:

```json
{
  "summary": { "attempted": 2, "connected": 1, "failed": 1, "skipped": 0 },
  "results": [
    { "platformId": "telegram", "status": "connected", "accountName": "My Channel" },
    { "platformId": "wordpress", "status": "failed", "detail": "WordPress verification: HTTP 401 …" }
  ]
}
```

- Admin-only, rate limited to 20 bulk requests per 10 minutes per operator.
- Maximum 25 entries per request; duplicate platform IDs are rejected instead of silently overwriting.
- Each connection is written with the active `workspace_id`, so a client workspace never sees another
  client's credentials.
- Credentials are encrypted with AES-256-GCM before the row is written; the response never contains them
  (T46 checks the stored ciphertext is unreadable and carries no plaintext).
- Audit rows: `account.bulk_connect` (summary) and `account.connected` (per platform, `via: "bulk"`).

## Metadata source

`src/lib/platforms/quick-connect.ts` holds the 25 links and micro-instructions; `GET /api/platforms`
returns them as `quickConnect`, `tier` and `tierLabel` so the UI and the docs cannot drift.
