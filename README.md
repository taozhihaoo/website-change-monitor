# Website Change Monitor

A small, self-hosted service that watches public web pages for content changes: you give it a URL, a selector for the part you care about, and an interval — it extracts, normalizes, hashes and compares the content on a schedule, records every check in SQLite, and sends a webhook when something actually changed.

Built as an independently developed portfolio/reference project — small but complete: real scheduling, real extraction, real history, real notifications, all runnable offline.

![Dashboard](docs/screenshots/01-dashboard.png)

## Features

- **Monitors** — create, update, enable/disable, delete, run on demand; each has a URL, a selector, a selector type and a check interval.
- **Three selector types** — CSS selectors, XPath expressions, and plain-text matching (monitors the lines of the page body containing your text).
- **Playwright-based extraction** — one shared Chromium, isolated context per check, honest user agent, images/media/fonts skipped.
- **Noise-resistant change detection** — content is normalized (line endings, whitespace, empty lines) then SHA-256 hashed; only semantic changes produce events.
- **Baseline semantics** — the first successful check stores a baseline and never notifies; from the second check on, differences create change events.
- **Idempotent events** — a UNIQUE constraint on `(monitor_id, current_hash)` means the same content state never produces a second event or notification.
- **Check history** — every attempt (success or failure) is recorded with status, duration and a safe error code.
- **Change history with diffs** — line-level added/removed blocks, previous vs current content, notification status per event.
- **Notifications** — webhook provider (JSON POST with bounded retries) and a mock provider; a failed webhook never fails the check.
- **Bounded scheduler** — global concurrency limit, per-monitor re-entrancy guard, restart-safe (state derived from the database), graceful shutdown.
- **Test extraction** — preview exactly what would be monitored before saving a monitor, with no persistence.
- **Web UI** — dashboard with stats, monitor list, detail view with diffs and histories, add/edit forms with extraction preview, loading/error/empty states, confirmations for destructive actions.
- **Offline demo & offline tests** — `npm run demo` and the whole test suite run against local fixtures, never the internet.

## Use Cases

- Product price / stock changes on public shop pages
- Job postings and announcement pages
- Documentation or policy updates
- Public competitor pages (public information only)
- Any public page where a specific region of text matters

## Architecture

```
                ┌────────────┐
   monitors ───▶│  Scheduler │ every tick: enabled + due + not running
                └─────┬──────┘
                      ▼  bounded queue (MAX_CONCURRENT_CHECKS)
                ┌────────────┐
                │CheckService│ one check_run row per attempt
                └─────┬──────┘
                      ▼
   URL guard → Playwright (shared browser, isolated context)
                      ▼
   extract (css/xpath/text) → normalize → sha256
                      ▼
   compare with latest snapshot
   ├─ first run ────────▶ baseline (no notification)
   ├─ same hash ────────▶ unchanged
   └─ different hash ───▶ snapshot + change event (UNIQUE idempotency)
                                  │
                                  ▼  async, failure-isolated
                        NotificationService → webhook / mock
```

Layers: `api/` (Fastify routes, thin) · `services/` (business logic) · `repositories/` (parameterized SQL) · `browser/` (Playwright lifecycle) · `scheduler/` (tick loop + bounded queue) · `notifications/` (provider abstraction) · `db/` (SQLite + numbered migrations). REST API and webhook payloads use snake_case; internal TypeScript uses camelCase.

## Screenshots

| Dashboard | Change history with diff |
| --- | --- |
| ![Dashboard](docs/screenshots/01-dashboard.png) | ![Monitor detail](docs/screenshots/02-monitor-detail-diff.png) |

Test extraction before saving:

![Test extraction](docs/screenshots/03-add-monitor-test-extraction.png)

## Requirements

- Node.js 22 or 24 (developed on Node 24)
- npm 10+
- Playwright Chromium (installed via `npx playwright install chromium`)
- Docker (optional)

## Installation

```bash
git clone https://github.com/taozhihaoo/website-change-monitor.git
cd website-change-monitor
npm install
npx playwright install chromium
cp .env.example .env   # optional; defaults work out of the box
```

## Quick Start

```bash
npm run dev        # server + API on http://localhost:3000 (serves the built UI)
npm run dev:web    # optional: Vite dev server for UI work (proxies /api calls)
```

Production build:

```bash
npm run build
npm start          # serves API + built UI on http://localhost:3000
```

## Demo

Fully offline — starts a local fixture page ($99), checks it (baseline), changes it to $89, detects the change, delivers a mock notification, and proves idempotency:

```bash
npm run demo
```

```
Check #1 — first run          status baseline   content "$99"
Check #2 — nothing changed    status unchanged  content "$99"
Check #3 — change detected    status changed    $99 → $89   diff +1/−1
Check #4 — idempotency        status unchanged  (no duplicate event/notification)
```

You can also serve the fixtures manually with `npm run serve:fixture` (http://127.0.0.1:8931) and create monitors against it while `ALLOW_PRIVATE_TARGETS=true`.

## Configuration

All configuration is via environment variables (see `.env.example`). Secrets never go into the database or log output.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_PORT` | `3000` | HTTP port |
| `DB_PATH` | `data/wcm.db` | SQLite file (created on demand) |
| `LOG_LEVEL` | `info` | pino level |
| `BROWSER_HEADLESS` | `true` | Chromium headless mode |
| `MAX_CONCURRENT_CHECKS` | `5` | Global concurrency limit |
| `DEFAULT_TIMEOUT` | `30000` | Page load/extraction budget (ms) |
| `EXTRACTION_SETTLE_MS` | `1000` | Extra wait for rendering after load |
| `SCHEDULER_TICK_MS` | `10000` | Scheduler tick interval |
| `WEBHOOK_TIMEOUT_MS` | `8000` | Webhook request timeout |
| `WEBHOOK_MAX_ATTEMPTS` | `3` | Webhook retry attempts (5xx/429/network only) |
| `ALLOW_PRIVATE_TARGETS` | `false` | Allow localhost/private URLs — **for local dev/demo/tests only** |
| `DEFAULT_NOTIFICATION_PROVIDER` | `none` | Provider when a monitor has no webhook: `none` \| `mock` |

## Creating a Monitor

Via the UI ("Add monitor") or the API. Always use **Test extraction** first — it shows the exact normalized text that will be monitored and persists nothing.

## Selectors

| Type | Example | Meaning |
| --- | --- | --- |
| `css` | `.product-price` | Inner text of every matching element, joined |
| `xpath` | `//div[@class="price"]` | Same, located via XPath |
| `text` | `$99` | All lines of the page body containing the text |

Failure modes are explicit error codes: `SELECTOR_NOT_FOUND`, `TEXT_NOT_FOUND`, `EMPTY_EXTRACTION`, `TIMEOUT`, `NAVIGATION_ERROR`, `NETWORK_ERROR` — a failed check never disables a monitor.

## Scheduling

Intervals are per-monitor seconds (UI presets: 5 min … 24 h; API accepts ≥ 60 s). The scheduler ticks every `SCHEDULER_TICK_MS`, dispatching enabled monitors whose last run (success **or** failure) is older than their interval — failures count toward the interval, preventing error storms. A monitor is never checked twice in parallel; checks run through a bounded queue (`MAX_CONCURRENT_CHECKS`); manual runs jump the queue via `POST /monitors/:id/run`. After a restart the scheduler simply resumes — due-ness is derived from the database, not from memory. Shutdown drains the queue, closes the browser and the database.

## Change Detection

1. Every successful check stores a snapshot (extracted text, SHA-256, timestamp).
2. First check → `baseline`, no event, no notification.
3. Same hash as the previous snapshot → `unchanged`.
4. Different hash → `changed`: snapshot + change event (previous/current content, hashes, line diff). The `UNIQUE(monitor_id, current_hash)` constraint makes events idempotent — if content returns to a previously seen state, no duplicate event is created (see Limitations).
5. Notifications are asynchronous: `changed → DB saved → webhook failed` still ends with a successful check and a failed delivery record.

## Notifications

`NotificationProvider` abstraction with two implementations:

- **webhook** — POSTs the JSON payload below to the monitor's webhook URL; retries on network errors, timeouts, 5xx and 429 (up to `WEBHOOK_MAX_ATTEMPTS`, exponential backoff), no retry on other 4xx. Deliveries are recorded per event (provider, sanitized target = origin only, attempts, last error). Test it with `POST /monitors/:id/test-notification`.
- **mock** — logs the payload; used by the demo/tests and via `DEFAULT_NOTIFICATION_PROVIDER=mock`.

```json
{
  "event": "content_changed",
  "monitor_id": "…",
  "monitor_name": "Acme product price",
  "url": "https://example.com/product",
  "detected_at": "2026-09-30T05:04:19.343Z",
  "previous_hash": "735ad7c6…",
  "current_hash": "bcb852ad…",
  "diff": { "added": 1, "removed": 1, "changes": [ … ] }
}
```

## REST API

| Method & Path | Purpose |
| --- | --- |
| `GET /health` | Liveness + scheduler snapshot |
| `GET /scheduler/status` | Active/queued checks, running monitors |
| `GET /stats` | Dashboard aggregates |
| `GET /monitors` | List with last check / last change / next check |
| `POST /monitors` | Create (validated, URL-guarded) → 201 |
| `GET /monitors/:id` | Detail with summary fields |
| `PATCH /monitors/:id` | Partial update |
| `DELETE /monitors/:id` | Delete (cascades history) → 204 |
| `POST /monitors/:id/run` | Run now → 202 queued; `?wait=1` waits for the result |
| `GET /monitors/:id/runs` | Check history (paged) |
| `GET /monitors/:id/snapshots` | Snapshot history (paged) |
| `GET /monitors/:id/changes` | Change events incl. diff + deliveries |
| `GET /monitors/:id/notifications` | Notification deliveries |
| `POST /monitors/:id/test-notification` | Send a test notification |
| `POST /monitors/test-extraction` | Preview extraction — persists nothing |

Errors use one envelope and never leak stack traces:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.", "details": { … } } }
```

`400` validation / blocked URL · `404` unknown monitor · `409` monitor already checking · `422` extraction failures · `500` safe internal error with a request id.

## Data Model

```
monitors(id, name, url, selector, selector_type, check_interval_seconds,
         enabled, webhook_url, created_at, updated_at)
snapshots(id, monitor_id→, content_hash, content, checked_at)
change_events(id, monitor_id→, previous_hash, current_hash,
              previous_content, current_content, diff_json, detected_at,
              UNIQUE(monitor_id, current_hash))
check_runs(id, monitor_id→, triggered_by, status, error_code, error_message,
           duration_ms, started_at, finished_at)
notification_deliveries(id, change_event_id→, monitor_id→, provider, target,
                        status, attempts, last_error, created_at, updated_at)
schema_migrations(version, applied_at)
```

Schema is created by numbered, transactional migrations embedded in the server. All SQL is parameterized; foreign keys cascade on delete.

## Testing

92 offline tests (Vitest) — no internet, no real target sites, no external services:

```bash
npm test               # 77 unit tests: url guard, normalize/hash/diff, pipeline
                       # semantics, idempotency, retries, scheduler, queue, CRUD
npm run test:integration # 15 integration tests: real Chromium + local fixture
                       # server + real SQLite + HTTP API (fastify inject)
npm run check          # lint + typecheck + unit tests
```

Integration coverage includes the full story: create → baseline → unchanged → fixture changes → changed + event + notification → no duplicates; selector failures; test-extraction isolation; and the API surface (validation, 404s, run-now, persistence checks).

## Docker

```bash
docker compose up --build
```

Multi-stage build (Node 24 slim): compiles server + client, prunes dev dependencies, installs Chromium, runs as a non-root `app` user, keeps SQLite in the `wcm-data` named volume, exposes a `/health`-based HEALTHCHECK.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on Node 22 and 24: install → Playwright Chromium → lint → typecheck → unit tests → integration tests (offline) → build.

## Security

- **URL guard** — only public http(s) URLs: rejects credentials-in-URL, localhost, `.local/.internal/...`, loopback/private/link-local/CGNAT IPv4 (incl. IPv4-mapped IPv6), IPv6 loopback/unspecified/ULA/link-local. Applied at creation, update *and* every check; webhook targets go through the same guard.
- Parameterized SQL everywhere; unified error envelope without stack traces; request ids on internal errors.
- Secrets only via environment variables; webhook targets stored sanitized (origin only); pino redaction list for credential-ish fields.
- The SPA is served from the same origin as the API; no authentication is included in v1 (see Limitations) — bind it to a trusted network.

## Responsible Use

This tool is for monitoring **public pages or resources you are authorized to access**. You are responsible for complying with the target site's robots.txt, Terms of Service, rate limits and applicable law. The default cadence is deliberately conservative (minutes, not seconds), requests identify themselves with an honest user agent, and the project intentionally implements **no** CAPTCHA bypass, anti-bot bypass, proxy rotation, fingerprint spoofing, stealth scraping or Cloudflare bypass. It is a monitoring utility, not an evasion tool.

## Limitations

Honest list — please read before relying on this:

- **No authentication** on the API/UI in v1. Run it on a trusted network or put it behind your own reverse proxy.
- **No DNS-level SSRF protection** — the URL guard blocks literal private addresses, but a public hostname resolving to a private IP (or DNS rebinding) is not re-checked at connect time.
- **Idempotency is per content state** — if content goes A→B→A, returning to A creates no new event (it already exists); you see the restore as `changed` but without a second notification for A.
- **No CAPTCHA / anti-bot handling** — by design. Sites that block bots will simply yield `NAVIGATION_ERROR`/`NETWORK_ERROR`.
- **No distributed workers** — one process, one browser, one SQLite file.
- **SQLite is intended for lightweight deployments** (single node, modest scale).
- **Browser-based extraction breaks when page structure changes** — selectors are fragile by nature; the error history helps you notice.
- **Snapshot growth is unbounded** — every successful check stores a snapshot; prune manually today, retention policy is on the roadmap.
- **Email/SMTP provider is not implemented** — the provider abstraction is there; webhooks + mock ship in v1.
- **Monitors public/authorized content only** — see Responsible Use.

## Project Structure

```
website-change-monitor/
├── src/                    # server (TypeScript, ESM, strict)
│   ├── api/                # Fastify app, routes, schemas, error envelope
│   ├── browser/            # shared-Chromium BrowserManager
│   ├── config/             # zod-validated environment config
│   ├── db/                 # better-sqlite3, migrations
│   ├── domain/             # entities + AppError codes
│   ├── notifications/      # provider abstraction, webhook, mock
│   ├── repositories/       # parameterized SQL data access
│   ├── scheduler/          # tick loop + bounded queue
│   ├── services/           # monitor, check pipeline, extraction, diff
│   └── utils/              # url guard, hash, normalize, logger, clock
├── client/                 # React 19 + Vite + TypeScript SPA
│   └── src/{api,components,pages}
├── fixtures/               # site-v1.html / site-v2.html (offline demo)
├── scripts/                # demo, fixture server
├── test/unit/              # 77 unit tests
├── test/integration/       # 15 integration tests (real browser, offline)
└── docs/screenshots/       # real screenshots from a running instance
```

## Roadmap

- Email (SMTP) notification provider
- Snapshot retention / pruning policy
- Optional authentication (single-user token)
- DNS-resolution-level SSRF re-checks
- Per-monitor normalization options (e.g. ignore numbers)
- Docker image publication

## License

MIT
