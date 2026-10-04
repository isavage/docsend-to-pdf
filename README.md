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
