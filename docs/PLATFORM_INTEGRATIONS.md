# Platform integration matrix

**Last reviewed:** November 2025 · **Primary sources:** each provider's official developer documentation
(links below).

This matrix reflects what the code in `src/lib/platforms/adapters/` actually does. Where an API cannot do
something, the adapter says so and the dashboard reports the real limitation — no endpoint is invented, and
no platform is marked "connected" without a successful API verification.

## Summary

| # | Platform | Group | Official API used | Auth | Image upload | Auto-publish | Gate |
|---|---|---|---|---|---|---|---|
| 1 | WordPress | A | REST API v2 `/wp-json/wp/v2/posts`, `/media` | Application Password (Basic) | ✅ binary upload | ✅ | none |
| 2 | Blogger | A | Blogger API v3 `/blogs/{id}/posts` | Google OAuth 2.0 | ⚠️ URL only (no media store) | ✅ | OAuth app |
| 3 | Telegram | A | Bot API `sendPhoto` / `sendMediaGroup` | Bot token | ✅ multipart | ✅ | bot must be channel admin |
| 4 | Discord | A | `POST /channels/{id}/messages`, webhooks | Bot token or webhook | ✅ multipart | ✅ | channel permissions |
| 5 | Bluesky | A | `com.atproto.repo.createRecord`, `uploadBlob` | App Password → session JWT | ✅ blob upload | ✅ | none |
| 6 | Mastodon | A | `/api/v2/media`, `/api/v1/statuses` | User access token | ✅ multipart | ✅ | instance token |
| 7 | Tumblr | A | API v2 `/blog/{blog}/posts` (NPF + legacy) | OAuth 2.0 | ✅ base64/NPF | ✅ | registered app |
| 8 | DEV.to | A | Forem API `/api/articles` | `api-key` header | ⚠️ URL only (`main_image`) | ✅ | none |
| 9 | Hashnode | A | GraphQL `publishPost` | Personal access token | ⚠️ URL only | ⚠️ plan gated | Hashnode approval/plan |
| 10 | Ghost | A | Admin API `/posts/`, `/images/upload/` | Admin API key (HS256 JWT) | ✅ multipart | ✅ | custom integration |
| 11 | Pinterest | B | API v5 `/media`, `/pins` | OAuth 2.0 | ✅ register+upload | ⚠️ approval | standard access review |
| 12 | LinkedIn | B | `/rest/images`, `/rest/posts` | OAuth 2.0 | ✅ initialize+PUT | ✅ personal; ⚠️ org | Community Management API for pages |
| 13 | Google Business Profile | B | v4 `localPosts`, v1 accounts/locations | Google OAuth 2.0 | ⚠️ URL only | ⚠️ approval | Business Profile API access |
| 14 | X | B | `/2/tweets`, `/2/media/upload` (+v1.1 fallback) | OAuth 2.0 PKCE | ✅ multipart | ⚠️ paid tier | paid API plan |
| 15 | Flickr | B | REST `upload`, signed requests | OAuth 1.0a (HMAC-SHA1) | ✅ multipart | ✅ | app + user tokens |
| 16 | YouTube Shorts | B | Data API v3 resumable upload | Google OAuth 2.0 | ⚠️ video required | ✅ | quota + verification |
| 17 | Slack | B | `files.getUploadURLExternal` → `completeUploadExternal`, `chat.postMessage` | Bot token | ✅ external upload | ✅ | bot in channel |
| 18 | Matrix | B | Client-Server API `/send/m.room.message`, media upload | Access token | ✅ media repo | ✅ | joined room |
| 19 | Behance | C | none available | — | manual | ❌ | — |
| 20 | Dribbble | C | none available for shots | — | manual | ❌ | — |
| 21 | Quora | C | none available | — | manual | ❌ | — |
| 22 | Reddit | C | API exists (OAuth) but self-promo rules + app registration; not automated here | — | manual | ❌ | — |
| 23 | IndiaMART | C | none public for listings | — | manual | ❌ | — |
| 24 | Justdial | C | none public for listings | — | manual | ❌ | — |
| 25 | GoodFirms | C | none public | — | manual | ❌ | — |

Legend: ✅ supported · ⚠️ supported with a stated constraint · ❌ not supported by the platform.

---

## Per-platform notes

### 1. WordPress
- Endpoints: `GET /wp-json/wp/v2/users/me?context=edit`, `POST /wp-json/wp/v2/media`,
  `POST /wp-json/wp/v2/posts`.
- Auth: HTTP Basic with an **Application Password** (Users → Profile → Application Passwords, WP 5.6+,
  HTTPS required). Normal login passwords are never requested.
- Images: uploaded to the media library and set as `featured_media`.
- Requires: `publish_posts` capability; REST API reachable from the server (not blocked by a security
  plugin or private network).
- Docs: <https://developer.wordpress.org/rest-api/reference/posts/>

### 2. Blogger
- Endpoints: `GET /blogger/v3/users/self/blogs`, `POST /blogger/v3/blogs/{blogId}/posts/`.
- Auth: Google OAuth 2.0 with `https://www.googleapis.com/auth/blogger`.
- Images: the Blogger API **cannot host files**. The adapter embeds `<img src>` only when
  `PUBLIC_BASE_URL` gives the poster a public URL; otherwise it publishes text and logs the limitation.
- Refresh tokens are used automatically when present.
- Docs: <https://developers.google.com/blogger/docs/3.0/reference/posts/insert>

### 3. Telegram
- Endpoints: `getMe`, `getChat`, `sendPhoto`, `sendMediaGroup`, `sendMessage`.
- Auth: bot token from @BotFather. The bot must be an **administrator** of the target channel.
- Images: single photo with caption (1024 chars) or album of up to 10 images.
- Returns `message_id`; the dashboard links to `t.me/<channel>/<id>` when the channel has a public username.
- Docs: <https://core.telegram.org/bots/api#sendphoto>

### 4. Discord
- Endpoints: `POST /api/v10/channels/{channel_id}/messages` (multipart) or a channel webhook with
  `?wait=true` (returns the message object).
- Auth: bot token (needs View Channel, Send Messages, Attach Files) **or** a webhook URL scoped to one
  channel. Webhooks are the lowest-privilege option and are recommended.
- Docs: <https://discord.com/developers/docs/resources/message#create-message>

### 5. Bluesky
- Endpoints: `com.atproto.server.createSession`, `com.atproto.repo.uploadBlob`,
  `com.atproto.repo.createRecord` (`app.bsky.feed.post`).
- Auth: App Password (Settings → Privacy and Security → App Passwords); the main password is never used.
- Images: up to 4 blobs with alt text. Link facets are computed from UTF-8 byte offsets.
- 300-character limit enforced; a session is created per publish (short-lived token model).
- Docs: <https://docs.bsky.app/docs/get-started>

### 6. Mastodon
- Endpoints: `/api/v1/accounts/verify_credentials`, `/api/v2/media` (+ poll `/api/v1/media/:id` while
  processing), `/api/v1/statuses`.
- Auth: per-instance user token with `write:statuses` + `write:media`.
- Any instance is supported (https only). Character limit is capped at 500 regardless of instance.
- Docs: <https://docs.joinmastodon.org/methods/statuses/>

### 7. Tumblr
- Endpoints: `GET /v2/user/info`, `POST /v2/blog/{blog}/posts`.
- Auth: OAuth 2.0 (`basic write offline_access`).
- Primary path is Neue Post Format with a base64 image block; a legacy photo/text post is attempted if NPF
  is rejected. Blog identifier is required (e.g. `yourblog.tumblr.com`).
- Docs: <https://www.tumblr.com/docs/en/api/v2>

### 8. DEV.to (Forem)
- Endpoints: `GET /api/users/me`, `POST /api/articles`.
- Auth: `api-key` header (Settings → Extensions → DEV Community API Keys). Any Forem instance can be used via
  the optional API base field.
- Images: `main_image` must be a **URL**; the adapter only sets it when a public media URL exists.
- Max 4 tags, all lowercase alphanumeric. The adapter writes **real educational articles**, not adverts.
- Docs: <https://developers.forem.com/api/v1#tag/articles/operation/createArticle>

### 9. Hashnode
- Endpoint: GraphQL `https://gql.hashnode.com` — `me`, `publishPost`.
- Auth: personal access token. Publication ID is auto-detected from `me.publications` unless supplied.
- **Access is gated:** Hashnode has changed/limited API publishing for some plans. If not enabled for your
  account, the GraphQL error is surfaced verbatim and the post is not published. Status: *approval required*.
- Docs: <https://apidocs.hashnode.com/>

### 10. Ghost
- Endpoints: `GET /ghost/api/admin/site/`, `POST /ghost/api/admin/images/upload/`,
  `POST /ghost/api/admin/posts/?source=html`.
- Auth: Admin API key (`id:secret`) → HS256 JWT with `aud: /admin/`, 5-minute expiry.
- Works with Ghost(Pro) and self-hosted. Feature image is uploaded and attached automatically.
- Docs: <https://ghost.org/docs/admin-api/>

### 11. Pinterest
- Endpoints: `GET /v5/user_account`, `/v5/boards`, `POST /v5/media` → upload URL → `POST /v5/pins`.
- Auth: OAuth 2.0 (`pins:write`, `boards:read`, `user_accounts:read`).
- **Requires standard-access approval**; trial apps are limited to the owner's test account. Board selection
  is mandatory (auto-picks the first board during verification, editable in Destinations).
- Image is 1000×1500 (2:3) in the generated copy.
- Docs: <https://developers.pinterest.com/docs/api/v5/pins-create/>

### 12. LinkedIn
- Endpoints: `GET /v2/userinfo`, `GET /v2/organizationAcls`, `POST /rest/images?action=initializeUpload`
  → PUT binary → `POST /rest/posts` with `LinkedIn-Version` and `X-Restli-Protocol-Version` headers.
- Auth: OAuth 2.0. Personal posting needs `w_member_social`; company pages need `w_organization_social`
  **and** an administrator role, which the adapter checks before posting (otherwise it refuses with an
  explanation). The Community Management API requires LinkedIn approval.
- Docs: <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api>

### 13. Google Business Profile
- Endpoints: `mybusinessaccountmanagement/v1/accounts`,
  `mybusinessbusinessinformation/v1/accounts/{id}/locations`, and the legacy v4
  `localPosts` endpoint (still the only one supporting local posts).
- Auth: OAuth 2.0 with `business.manage`. **Google approval is required** for API access.
- Only locations the authorized Google account manages can be posted to; a public image URL is required for
  media, otherwise a text post is created and logged.
- Docs: <https://developers.google.com/my-business/reference/rest>

### 14. X (Twitter)
- Endpoints: `GET /2/users/me`, `POST /2/media/upload` (falls back to v1.1
  `upload.twitter.com/1.1/media/upload.json` on 403/404), `POST /2/tweets`.
- Auth: OAuth 2.0 PKCE with `tweet.read tweet.write users.read media.write offline.access`.
- **Not free:** posting requires a paid API tier. Rate-limit and plan errors are shown exactly as returned.
- 280 characters, max 2 hashtags in generated copy.
- Docs: <https://docs.x.com/x-api/posts/creation-of-a-post>

### 15. Flickr
- Endpoints: `flickr.test.login` (signed GET) and `up.flickr.com/services/upload/` (signed multipart).
- Auth: OAuth 1.0a — the signature base string is built with HMAC-SHA1 over sorted, percent-encoded
  parameters; the Authorization header carries the signature.
- Uploads go to your own photostream (`is_public=1`), returning a `photoid`.
- Commercial-use terms apply; review Flickr's guidelines before high-volume promotion.
- Docs: <https://www.flickr.com/services/api/upload.api.html>

### 16. YouTube Shorts
- Endpoints: `GET /youtube/v3/channels?mine=true`,
  `POST /upload/youtube/v3/videos?uploadType=resumable` → PUT to the returned `Location`.
- Auth: OAuth 2.0 `youtube.upload` (+ `youtube.readonly` for verification).
- **A Short is video.** ROYALWEB renders a 12-second 1080×1920 MP4 from the poster with ffmpeg when
  available, or uploads an MP4 you attach to the campaign. If neither exists the job fails with
  `video_required` — it never pretends a static image was published.
- Quota: one upload costs 1,600 units of the 10,000/day default.
- Docs: <https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol>

### 17. Slack
- Endpoints: `auth.test`, `conversations.info`,
  `files.getUploadURLExternal` → POST bytes → `files.completeUploadExternal` (current flow; the deprecated
  `files.upload` is **not** used), `chat.postMessage`, `chat.getPermalink`.
- Auth: bot token with `chat:write`, `files:write`, `channels:read`. The bot must be a member of the channel.
- Docs: <https://api.slack.com/methods/files.completeUploadExternal>

### 18. Matrix
- Endpoints: `/_matrix/client/v3/account/whoami`, media upload (`/_matrix/media/v3/upload`, falling back to
  `/_matrix/client/v1/media/upload`), `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}`.
- Auth: user access token; the account must have joined the room and have permission to post.
- Images are uploaded to the homeserver and sent as `m.image` events with a text fallback body.
- Docs: <https://spec.matrix.org/latest/client-server-api/#sending-messages>

### 19–25. Manual / assisted publishing
Behance, Dribbble, Quora, Reddit, IndiaMART, Justdial and GoodFirms do not offer a supported public
publishing API for this workflow (and Reddit's API use for promotional posting is constrained by subreddit
rules and Reddit policy). ROYALWEB therefore:

- generates platform-appropriate copy (project description, shot title, Quora answer, discussion draft,
  seller listing, agency profile…),
- produces the platform-sized image,
- bundles everything into a ZIP with step-by-step instructions,
- records the task so you can mark it published yourself.

No browser automation, no login bypass, no CAPTCHA solving, no rate-limit evasion.

---

## Verification checklist for operators

Before trusting a new integration in production, use **Connected Accounts → Verify** (which performs a live
API call) and then a single test post:

1. Confirm the destination (board / channel / blog / location) is the intended one.
2. Publish a low-risk test campaign to that platform only.
3. Open the returned post URL from **Published Posts**.
4. Review <https://your-domain/dashboard/security> → *Publishing log* for the exact request/response summary.
5. If a provider changes its API, only the corresponding adapter file needs updating.
