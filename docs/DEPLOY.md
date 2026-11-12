# Deploying ROYALWEB AUTOPILOT

Two supported shapes. Read the first paragraph of each before choosing — the difference is where the
database lives, and it decides whether your data survives.

| | **Disk host** (recommended) | **Vercel (serverless)** |
| --- | --- | --- |
| Hosts | Docker, Railway, Render, Fly.io, Hetzner/VPS, any box with a volume | Vercel |
| Database | SQLite file on a persistent volume | SQLite in `/tmp` — **resets when the instance recycles** |
| Uploaded posters | Persisted on the volume | Lost on recycle |
| Publishing worker | In-process timer (20 s) + supervisor (60 s) | Cron → `/api/worker/tick` |
| Cost | ~$5/mo | free tier |
| Verdict | production | demo / evaluation, or front-end preview |

The app tells you which mode it is in: [`/api/health`](../src/app/api/health/route.ts) reports
`runtime.storage` (`persistent` \| `ephemeral`), and the dashboard shows a banner when storage is ephemeral.
Nothing is ever reported as durable when it is not.

---

## Option A — Vercel

Deploys and builds cleanly. **What it cannot do is keep your data**: Vercel gives each invocation a throw-away
filesystem, so the SQLite database lives in `/tmp/royalweb` and is recreated empty on the next cold start.

That is fine to click through the product, verify the AI/content pipeline, or hand a preview link to a client.
It is not fine for campaigns you care about.

```bash
npm i -g vercel
vercel link
vercel env add NEXT_PUBLIC_APP_NAME production      # optional branding
vercel env add CRON_SECRET production               # openssl rand -hex 32 — required for cron
vercel env add PUBLIC_BASE_URL production           # https://<your-project>.vercel.app
vercel env add ROYALWEB_MASTER_KEY production       # 32+ random chars
vercel env add ROYALWEB_ADMIN_EMAIL production
vercel env add ROYALWEB_ADMIN_PASSWORD production
vercel --prod
```

Then open the deployment, create the administrator on first load, and add credentials through
**Connected Accounts → Quick-connect wizard**.

### What already works on Vercel

- `vercel.json` pins the region (`bom1`, Mumbai) and registers two crons:
  `/api/worker/tick` every 5 minutes and `/api/alerts/check` every 30 minutes.
  Vercel sends `Authorization: Bearer $CRON_SECRET` automatically; without that variable the endpoints refuse
  the call and the dashboard banner warns you.
- `engines.node >= 22.13` is required and declared in `package.json` — that is the first Node release where
  `node:sqlite` no longer needs the `--experimental-sqlite` flag.
- The in-process worker and supervisor are skipped on serverless (`src/instrumentation.ts`), so you never get
  a function that hangs on a `setInterval`.
- Storage paths are resolved by `src/lib/runtime.ts`; nothing tries to write into the read-only bundle.
- `sharp` is marked as an external server package, and image optimisation is off (posters are served by an
  authenticated API route).

### Plan limits to expect

- **Hobby**: crons may run at most once per day and functions cap at 60 s. Publishing then happens daily —
  change the crons to `0 3 * * *`, or move to Pro.
- **Pro**: minute-level crons and 300 s functions; set `/api/worker/tick` to `* * * * *` for 60-second
  publishing.
- **Function duration**: `schedule` is allowed 120 s, `alerts/check` and `worker/tick` 60 s.

### Making Vercel durable

Point `ROYALWEB_DATA_DIR` at durable storage **only if it is a real POSIX volume** (Vercel has none today).
Two honest options instead:

1. Move to Option B below (same code, a volume, ten minutes).
2. Keep Vercel for the UI and run the API/worker on a disk host; this requires a split deployment that the
   app does not support out of the box.

---

## Option B — Docker / Railway / Render / Fly / VPS (production)

One image, one volume, zero cloud-lock.

```bash
docker build -t royalweb .
docker run -d --name royalweb -p 3000:3000 \
  -v royalweb_data:/app/data \
  -e ROYALWEB_MASTER_KEY="$(openssl rand -hex 32)" \
  -e ROYALWEB_ADMIN_EMAIL="you@yourdomain.in" \
  -e ROYALWEB_ADMIN_PASSWORD="a-long-unique-password" \
  -e PUBLIC_BASE_URL="https://app.yourdomain.in" \
  royalweb
```

Open `http://localhost:3000`, create the administrator, connect platforms. The container:

- runs as a non-root user (`royalweb`, uid 1001),
- declares `VOLUME /app/data` (database, uploads, snapshots),
- ships a `HEALTHCHECK` against `/api/health`,
- uses `tini` as PID 1 so the worker timer is reaped cleanly on stop.

### Railway

`railway.json` is included (Dockerfile builder, health check, restart on failure):

```bash
railway init && railway up
railway volume add --mount-path /app/data
railway variables set ROYALWEB_MASTER_KEY=... ROYALWEB_ADMIN_EMAIL=... ROYALWEB_ADMIN_PASSWORD=... PUBLIC_BASE_URL=https://<domain>
```

### Fly.io

`fly.toml` is included (Mumbai region, 3 GB volume mount, suspend when idle, one machine always up):

```bash
fly launch --no-deploy --copy-config
fly volumes create royalweb_data --size 3 --region bom
fly secrets set ROYALWEB_MASTER_KEY=... ROYALWEB_ADMIN_EMAIL=... ROYALWEB_ADMIN_PASSWORD=... PUBLIC_BASE_URL=https://<app>.fly.dev
fly deploy
```

### Render

New → Web Service → Docker. Add a **persistent disk** mounted at `/app/data` (1 GB is plenty), then set the
same environment variables. Health check path: `/api/health`.

### VPS (systemd)

```ini
[Service]
WorkingDirectory=/opt/royalweb
ExecStart=/usr/bin/npm run start
Environment=NODE_ENV=production
Environment=ROYALWEB_DATA_DIR=/var/lib/royalweb
Environment=ROYALWEB_MASTER_KEY=...
Restart=always
```

Back it up with the built-in encrypted snapshots (**Automation & Alerts → snapshots**, daily or weekly) —
they capture the whole database, opt-out list included.

---

## Environment variables that matter

| Variable | Needed | Notes |
| --- | --- | --- |
| `ROYALWEB_MASTER_KEY` | **yes** | 32+ random chars. Encrypts every credential. Rotating it makes existing rows unreadable. |
| `ROYALWEB_ADMIN_EMAIL` / `ROYALWEB_ADMIN_PASSWORD` | yes on first boot | Creates the administrator when the database is empty. |
| `PUBLIC_BASE_URL` | yes in production | Public HTTPS origin. Used for `List-Unsubscribe`, OAuth redirect URIs and image URLs that platforms fetch. |
| `ROYALWEB_DATA_DIR` | Docker only | `/app/data` in the image; on a VPS point it at `/var/lib/royalweb`. |
| `CRON_SECRET` | serverless | Shared secret for `/api/worker/tick` and `/api/alerts/check`. |
| `ROYALWEB_WORKER_SECRET` | optional | Alternative header (`x-worker-secret`) for external schedulers. |
| `ROYALWEB_SQLITE_JOURNAL` | optional | Set to `delete` when the database sits on a network volume (WAL needs shared memory). |
| `ROYALWEB_ALLOW_PRIVATE_FETCH` | local only | Lets RSS ingestion reach private addresses. Never enable in production. |
| `ROYALWEB_TELEGRAM_API_BASE` | testing only | Points alerts at a local Telegram double. |

Full list: [`.env.example`](../.env.example).

---

## Smoke test after any deploy

```bash
curl -s https://<host>/api/health | jq
```

Expect `status: "ok"`, `platforms: 25`, and `runtime` telling you the truth:

```json
"runtime": { "platform": "vercel", "serverless": true, "storage": "ephemeral",
             "durable": false, "worker": "cron", "writable": true }
```

Then, in the dashboard: create a campaign → generate → schedule a minute ahead → watch it publish (on
serverless, trigger `POST /api/worker/tick` with `x-worker-secret`, or wait for the cron).

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Cannot find module 'node:sqlite'` | Node < 22.13 | Set Node 22 on the host (`engines` + `.nvmrc` are already set). |
| Data disappears after a while | Serverless ephemeral storage | Move to Option B, or expect a demo. `/api/health` says `storage: "ephemeral"`. |
| Scheduled posts never publish on Vercel | Crons disabled / `CRON_SECRET` missing | Set the variable, redeploy, check the Cron tab. Hobby allows daily crons only. |
| `SQLITE_BUSY` under load | Two instances on one database file | SQLite wants a single writer: run one instance per volume, or scale reads via replicas — not writes. |
| Login loops on HTTPS behind a proxy | Cookie `secure` with plain HTTP | Terminate TLS at the proxy and forward `X-Forwarded-Proto: https`; `PUBLIC_BASE_URL` must be the https origin. |
| Posters 404 after deploy | Files were in the previous instance's `/tmp` | Same cause as data loss — use a volume. |
| Function times out on schedule | `maxDuration` too low for many platforms | Already 120 s in `vercel.json`; raise on Pro (up to 300 s). |
| Email fails with `daily_limit` | Warm-up ramp (correct behaviour) | Raise the ramp in **Automation & Alerts → Email warm-up**. |
