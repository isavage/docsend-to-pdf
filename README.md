# DocSend PDF Converter

Turn any DocSend presentation link into a pixel-perfect PDF — no plugins required.

## Features

- **Headless browser conversion** — Playwright opens your DocSend link, waits for each slide to render, takes screenshots, and stitches them into a PDF using `pdf-lib`.
- **Password-protected links** — Enter the DocSend password and the converter handles auth automatically.
- **Expiration & view-only checks** — Fails fast with clear messages for expired links or restricted documents.
- **Progress tracking** — Real-time progress bar via Server-Sent Events (SSE).
- **Tier system** — Free tier: 10 slides max. Paid tier: unlimited + batch conversions + email delivery.
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
  (no `PUBLIC_URL` / CORS config needed),
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
    server_name docsend.example.com;

    ssl_certificate     /etc/letsencrypt/live/docsend.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/docsend.example.com/privkey.pem;

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
    server_name docsend.example.com;
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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_FILE_SIZE_BYTES` | `52428800` | Output file cap (50 MB) |
| `FREE_TIER_MAX_SLIDES` | `10` | Slides allowed for free users |
| `PAID_TIER_MAX_SLIDES` | `1000` | Slides allowed for paid users |
| `BROWSER_TIMEOUT_MS` | `60000` | Browser navigation timeout |
| `SLIDE_WAIT_MS` | `2000` | Pause between slide captures |
| `EMAIL_ENABLED` | `false` | Enable email delivery |
| `SMTP_HOST` | `` | SMTP relay host |

## Tech Stack

- **Backend**: Node.js · Express · TypeScript · Playwright · pdf-lib
- **Frontend**: React · Vite · Tailwind CSS · TypeScript
- **Testing**: Vitest (unit tests with mocked browser)
- **Deployment**: Docker Compose

## License

MIT
