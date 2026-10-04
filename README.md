# DocSend PDF Converter

Turn any DocSend presentation link into a pixel-perfect PDF — no plugins required.

## Features

- **Headless browser conversion** — Playwright opens your DocSend link, waits for each slide to render, takes screenshots, and stitches them into a PDF using `pdf-lib`.
- **Password-protected links** — Enter the DocSend password and the converter handles auth automatically.
- **Expiration & view-only checks** — Fails fast with clear messages for expired links or restricted documents.
- **Progress tracking** — Real-time progress bar via Server-Sent Events (SSE).
- **Free / Member tiers** — Anonymous visitors get 10 slides per conversion. Signed-in members (Google OAuth or email + password, with verified email) get up to 1,000 slides. Tier is derived server-side from the session — it can't be forged from the client. No payment required.
- **File size limit** — Configurable cap (default 50 MB).
- **AI pitch-deck analysis** — Post-conversion upsell: auto-analyze pitch decks for strengths, weaknesses, and a scoring rubric.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Frontend  │────▶│   Express    │────▶│  Playwright    │
│  React +    │  SSE│  API server  │     │  Chromium      │
│  Tailwind   │◀────│  + Job queue │     │  (headless)    │
└─────────────┘     └──────────────┘     └────────────────┘
                                        │
                                  ┌──────────────┐
                                  │  pdf-lib     │
                                  │  (stitch PDF) │
                                  └──────────────┘
```

## Quick Start

### Local development

```bash
# Backend
cd backend && npm install && npx playwright install chromium
npm run dev

# Frontend (another terminal)
cd frontend && npm install
npm run dev
```

### Docker Compose

```bash
docker compose up --build
# → http://localhost:4000
```

### Health check

```bash
curl http://localhost:4000/api/health
```

## Reverse Proxy (nginx)

The app is designed to run behind nginx on a domain (TLS terminates at nginx,
the container stays on plain HTTP :4000). The app already:

- serves the frontend and API from the same origin with relative `/api/*` URLs
  (no CORS config needed; set `PUBLIC_URL` so email verification links and the
  Google sign-in redirect use the real domain),
- sets `trust proxy` so `req.ip` / `req.protocol` reflect the forwarded request,
- sends `X-Accel-Buffering: no` on the SSE stream so progress events flush
  through nginx without extra config,
- binds `0.0.0.0` and only `expose`s port 4000 — **do not** add a `ports:`
  mapping; put the container on a shared network with the nginx container
  (e.g. `networks: [docsend2pdf.net]` on the nginx side too) and proxy by
  service name.

Reference nginx server block (adjust `server_name` and the proxy host to your
setup — `<container-name>:4000` works when nginx shares the compose network):

```nginx
server {
    listen 443 ssl http2;
    server_name docsend-to-pdf.online;

    ssl_certificate     /etc/letsencrypt/live/docsend-to-pdf.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/docsend-to-pdf.online/privkey.pem;

    # Match the app's MAX_FILE_SIZE_BYTES (50 MB), otherwise nginx
    # rejects uploads with 413 at its 1 MB default.
    client_max_body_size 50m;

    # Optional: also keep the app's long conversions from being cut off.
    # Downloads/uploads are fine, but raise these if jobs exceed 60s of
    # silence on the SSE stream.
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://app:4000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Needed for SSE /api/events/:id if you prefer buffering off here
        # instead of relying on the app's X-Accel-Buffering header:
        # proxy_buffering off;
    }
}

server {
    listen 80;
    server_name docsend-to-pdf.online;
    return 301 https://$host$request_uri;
}
```

Notes:
- The `/api/events/:id` SSE stream needs `proxy_http_version 1.1` + no
  buffering (the app's `X-Accel-Buffering: no` header covers the latter).
- Keep `Upgrade`/`Connection` header handling simple — there is no WebSocket
  usage, so the standard headers above are sufficient.
- The Docker healthcheck already targets `127.0.0.1:4000`, so it is unaffected
  by the proxy.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/convert` | Start a new conversion job |
| GET    | `/api/jobs/:id` | Get job status/details |
| GET    | `/api/events/:id` | SSE stream for real-time updates |
| GET    | `/api/download/:id` | Download the generated PDF |
| POST   | `/api/pitch-deck/analyze` | AI analysis of converted deck |
| GET    | `/api/health` | Health check |
| GET    | `/api/auth/config` | Public auth config (Google enabled, limits) |
| GET    | `/api/auth/me` | Current user + derived tier |
| POST   | `/api/auth/signup` | Create email/password account |
| POST   | `/api/auth/login` | Sign in with email/password |
| POST   | `/api/auth/logout` | Sign out (clears session) |
| GET    | `/api/auth/verify?token=` | Email verification link target |
| POST   | `/api/auth/resend-verification` | Re-send the verification email |
| GET    | `/api/auth/google` | Start Google OAuth sign-in |
| GET    | `/api/auth/google/callback` | OAuth redirect target |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_FILE_SIZE_BYTES` | `52428800` | Output file cap (50 MB) |
| `FREE_TIER_MAX_SLIDES` | `10` | Slides allowed for anonymous visitors |
| `MEMBER_TIER_MAX_SLIDES` | `1000` | Slides allowed for verified members |
| `BROWSER_TIMEOUT_MS` | `60000` | Browser navigation timeout |
| `SLIDE_WAIT_MS` | `2000` | Pause between slide captures |

### Auth / accounts

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `/app/data/app.db` | SQLite file (users/sessions/tokens). Keep it on a volume. |
| `SESSION_TTL_MS` | `2592000000` | Session lifetime (30 days) |
| `COOKIE_NAME` | `ds_session` | Session cookie name |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS nginx so the cookie is Secure-only (production value: `true`) |
| `PUBLIC_URL` | `http://localhost:4000` | Public origin; used in email verification links and the post-Google redirect. Production: `https://docsend-to-pdf.online` |
| `GOOGLE_CLIENT_ID` | `` | OAuth 2.0 client ID (Google Cloud Console → Credentials). Empty hides the Google button. |
| `GOOGLE_CLIENT_SECRET` | `` | Matching OAuth client secret |
| `EMAIL_ENABLED` | `false` | `true` **and** a non-empty `SMTP_HOST` enables real emails. Otherwise signup auto-verifies (member tier) and the verify link is logged to stdout — the backend also prints a startup warning if `EMAIL_ENABLED=true` but `SMTP_HOST` is empty. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | `` / `587` / `` / `` | SMTP relay for verification emails. Without `SMTP_HOST`, nodemailer would dial `127.0.0.1:587` and fail — that's why an empty host disables sending. |
| `FROM_ADDRESS` | `noreply@docsend-to-pdf.online` | From address on verification emails |

Google OAuth setup: create an **OAuth client ID (Web application)** at
console.cloud.google.com → APIs & Services → Credentials, and add
`https://docsend-to-pdf.online/api/auth/google/callback` under *Authorized
redirect URIs* (plus `http://localhost:4000/api/auth/google/callback` for local
dev).

## Tiers

- **free** — anonymous, no cookie. Cap: `FREE_TIER_MAX_SLIDES` (10).
- **member** — signed in (Google or email+password) **and** email verified.
  Cap: `MEMBER_TIER_MAX_SLIDES` (1,000).
- A signed-in but unverified user is treated as **free** until they click the
  verification link (the UI shows a "verify your email" banner).
- The tier is computed server-side per request from the session cookie; the
  `POST /api/convert` body no longer accepts a `tier` field at all.

## Deployment / Environment Injection

The GitHub Actions deploy (`.github/workflows/deploy.yml`) uses
`isavage/deploy@v3` against the VPS at `/docker/docsend-to-pdf`, building the
image on the server from source.

Secrets come from **Doppler**: the workflow passes
`doppler_token: ${{ secrets.DOPPLER_TOKEN }}` to the action, which runs
`doppler run -- docker compose ...` on the VPS. This is the only way the
compose file's `${SMTP_HOST}`, `${GOOGLE_CLIENT_ID}`, `${EMAIL_ENABLED}`, etc.
get real values — Doppler does **not** auto-inject into containers.

Requirements for this to work:

1. The `DOPPLER_TOKEN` secret (a `dp.st...` **service token**) must exist in
   the GitHub Environment the job uses (`prod-IN`). Without it, every `${VAR}`
   falls back to its compose default (empty), and emails silently fail with
   `connect ECONNREFUSED 127.0.0.1:587`.
2. Doppler must contain variables with the **exact names** used in
   `docker-compose.yml` (e.g. `SMTP_HOST`, not `smtp_host` or
   `SMTP_SERVER`).
3. `docker-compose.yml` must reference each variable explicitly (it does) —
   Doppler mode never writes a `.env` file on disk.

## Tech Stack

- **Backend**: Node.js · Express · TypeScript · Playwright · pdf-lib
- **Frontend**: React · Vite · Tailwind CSS · TypeScript
- **Testing**: Vitest (unit tests with mocked browser)
- **Deployment**: Docker Compose

## License

MIT
