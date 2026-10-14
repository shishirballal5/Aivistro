# AIVISTRO backend

NestJS **modular monolith** with a separate **BullMQ worker** process.
Stack: Node.js + TypeScript · NestJS 11 · MySQL 8 (InnoDB) · TypeORM + migrations · Redis + BullMQ · Swagger.

> **Status:** all five planned phases are implemented (foundation, auth + catalog, subscriptions/payments/entitlements,
> video upload/processing/playback, user features + analytics + monitoring). See *What is and isn't verified* below.

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | developed on 26 |
| MySQL | 8.x | Compose pins `mysql:8.4` |
| Redis | 7+ | BullMQ requires `maxmemory-policy noeviction` (Compose sets it) |
| Docker | optional | easiest way to get MySQL + Redis |
| FFmpeg + ffprobe | any recent | worker host (video processing) and e2e video tests |

## Local setup

```bash
cd backend
npm install
cp .env.example .env            # then set DB_PASSWORD and MYSQL_ROOT_PASSWORD

docker compose up -d            # MySQL 8.4 + Redis (or point .env at your own instances)

npm run migration:run           # create / update the schema
npm run start:dev               # API   → http://localhost:3000/api/v1
npm run start:worker:dev        # worker (separate terminal)
```

- Swagger UI: <http://localhost:3000/api/docs> (on by default outside production)
- Liveness: `GET /api/v1/health/live` · Readiness (MySQL + Redis): `GET /api/v1/health/ready`

The Docker Compose file also creates an isolated `aivistro_test` database for the e2e tests.
Without Docker, create two databases (`aivistro_dev`, `aivistro_test`) and a user with access to both.

## Environment variables

All are validated at start-up; the process refuses to boot on a bad value. See `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | pino level |
| `CORS_ORIGINS` | localhost dev origins | comma-separated; **`*` is rejected in production** |
| `TRUST_PROXY_HOPS` | `0` | reverse-proxy hops to trust for client IPs |
| `SWAGGER_ENABLED` | on, except production | serve `/api/docs` |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` | `60000` / `120` | global rate limit per client |
| `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_NAME` | localhost / 3306 / aivistro / aivistro_dev | MySQL |
| `DB_PASSWORD` | – | **required in production** |
| `DB_POOL_SIZE`, `DB_SSL`, `DB_LOGGING` | 10, false, false | pool size, TLS (verifies the cert), query logging |
| `DB_CONNECT_RETRIES` / `DB_CONNECT_RETRY_DELAY_MS` | 10 / 3000 | initial-connection retries, then the process exits non-zero |
| `REDIS_HOST` `REDIS_PORT` `REDIS_PASSWORD` `REDIS_DB` `REDIS_TLS` | localhost / 6379 / – / 0 / false | Redis |

Secrets only ever come from the environment. Commit `.env.example`, never `.env`.

## Database and migrations

- Entities use TypeORM decorators (`src/database/entities`); relationships and constraints live there.
- **The schema changes only through migrations.** `synchronize` is hard-coded to `false` (no env var can enable it) and
  migrations never run automatically on boot. A unit test enforces this.
- Money must be stored as integer **paise** in `BIGINT` columns. The driver returns BIGINT as strings, so values above 2^53
  never lose precision (covered by a test). Never use floats or `DOUBLE` for money.
- Every connection is forced onto the **UTC** session time zone (`src/database/mysql-utc-driver.ts`) so `CURRENT_TIMESTAMP`
  defaults are correct regardless of how the MySQL server is configured.
- Timestamps use `DATETIME(3)`. Extend `TimestampedEntity`: it spells out `CURRENT_TIMESTAMP(3)` because MySQL rejects a
  `DATETIME(3)` column with a different default precision (TypeORM would otherwise emit `(6)`).

```bash
npm run migration:generate -- src/database/migrations/AddSomething   # diff entities vs the database
npm run migration:run
npm run migration:revert                                             # undo the last migration
npm run migration:show                                               # [X] applied / [ ] pending
npm run migration:run:prod                                           # from compiled output (dist/), for deployments
```

Always review a generated migration before committing, and run it against a throwaway database first.

## Architecture notes

- `src/main.ts` is the HTTP API (`/api/v1` prefix). `src/worker.ts` is the background worker. Both import the same shared
  modules (config, database, queues) and the queue contracts in `src/modules/queues/queue.constants.ts`.
- `src/setup-app.ts` applies Helmet, CORS, the global `ValidationPipe` (unknown properties are **rejected**, not ignored; no
  implicit type conversion), and Swagger. The e2e tests use the same function, so they exercise production wiring.
- Every error has one shape: `{ statusCode, code, message, details?, requestId, timestamp, path }`. Unexpected errors become a
  generic 500; stack traces are never returned in production.
- Each request gets a correlation id (`x-request-id`; a caller-supplied value is accepted only if it is a safe token).
  Logs are structured JSON (pretty in development); `Authorization` and cookies are redacted.
- Queues: failed jobs retry 3× with exponential backoff and are **kept for 7 days** in BullMQ's failed set for inspection and
  manual retry (this is the recovery path; there is no separate dead-letter queue yet).
- `SIGTERM`/`SIGINT` trigger graceful shutdown (HTTP, MySQL, Redis, BullMQ). Nest re-raises the signal when it finishes, so a
  clean stop looks like "terminated by SIGTERM".
- Rate-limit counters live in Redis, so they are shared across API instances.

## Tests

```bash
npm test                 # unit tests: no database or Redis needed
npm run typecheck
npm run build
```

End-to-end tests run against **real MySQL and Redis**:

```bash
# 1) migrate the test database once (and after adding migrations)
DB_NAME=aivistro_test npm run migration:run
# 2) run (uses DB_* / REDIS_* from your environment or .env.test)
npm run test:e2e
```

The e2e suite refuses to run unless the database name ends in `_test`. It covers readiness/liveness, request ids, the error
shape, validation, security headers and CORS, rate limiting, UTC timestamps, unique keys, transaction commit/rollback, BIGINT
exactness, queue processing and retries, and the real server process failing fast (MySQL down) and degrading correctly
(Redis down).

## Feature map (all under `/api/v1`, Swagger at `/api/docs`)
Auth (OTP, Google/Apple, password, refresh rotation + reuse detection) · admin auth with mandatory TOTP MFA + recovery codes ·
RBAC admin management · catalog (genres, series, episodes; publish requires a READY video) · plans, checkout, verify,
signed webhooks, refunds · entitlements (**every episode requires an active subscription; there are no free episodes and no
coins**) · video upload (signed single-use URL) -> FFmpeg -> AES-128 HLS -> token-gated playback sessions with concurrent
stream limits · watch progress/history/watchlist · in-app notifications + FCM push · client analytics intake and
`/admin/dashboard` · health, metrics, audit log · viewer data rights (`GET /me/export`; `DELETE /me` erases personal data but
keeps payment records, needs the password or a sign-in within 10 minutes, and refuses with `ACTIVE_SUBSCRIPTION` unless the
viewer acknowledges losing the remaining paid time).

## Environment variables (beyond Phase 1)
See `.env.example` for the full annotated list. Groups: secrets/auth (`APP_SECRET`, token TTLs, `SMS_*`, `EMAIL_*`,
`GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`), payments (`PAYMENT_GATEWAY`, `RAZORPAY_*`), storage (`STORAGE_DRIVER`, `S3_*`),
video (`FFMPEG_PATH`, `MAX_UPLOAD_BYTES`, `MAX_VIDEO_SECONDS`, `MAX_CONCURRENT_STREAMS`, `PLAYBACK_*`), push (`PUSH_PROVIDER`,
`FCM_*`), monitoring (`METRICS_TOKEN`, `SENTRY_DSN`). Development providers (`dev`) and local storage are rejected in production.

## Seeds and admin bootstrap
```bash
npm run seed:dev                    # local demo data only; refuses production
ADMIN_EMAIL=you@co.com ADMIN_NAME="You" npm run admin:create       # local (random password printed once unless ADMIN_PASSWORD set)
ADMIN_EMAIL=you@co.com npm run admin:create:prod                    # production, from dist/ (no default credentials anywhere)
```

## Tests
```bash
npm run typecheck && npm test                       # unit
DB_NAME=aivistro_test npm run migration:run         # once, then
DB_NAME=aivistro_test npm run test:e2e              # real MySQL + Redis + FFmpeg
```
Last full run (this machine, MySQL 9.7, Redis, FFmpeg): typecheck clean, build OK, 129 unit tests and 324 e2e tests passing,
e2e process exits by itself, fresh-database migration run OK.

Where things are: [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md). All third-party clients: `src/util/thirdparty/`.

## Deployment
`Dockerfile` (multi-stage, Node 22, FFmpeg, non-root) and `docker-compose.prod.yml` (migrate -> api + worker). See
[docs/OPERATIONS.md](docs/OPERATIONS.md) for deploy order, failed-job handling, backups, secret rotation and incident response.

## Third-party credentials
| Integration | Needed for |
|---|---|
| S3 or Cloudflare R2 bucket + keys | video storage (`STORAGE_DRIVER=s3`) |
| Razorpay key id/secret + webhook secret | payments and refunds |
| SMS / email HTTP provider | OTP and emails |
| Google OAuth client ID / Apple client ID | social login (enabled only when set) |
| Firebase service account | push (`PUSH_PROVIDER=fcm`) |
| Sentry DSN (+ `npm i @sentry/node`) | error reporting (adapter untested live) |

When a credential is absent the integration is disabled or uses a clearly labelled development adapter (never in production).

## What is and isn't verified
Verified here by automated tests against real MySQL/Redis/FFmpeg: everything in the feature map using the dev payment
simulator, local storage and dev push/OTP adapters, including a full upload -> transcode -> encrypted playback decrypt.
**Not exercised against live services:** Razorpay, S3/R2, FCM, Apple/Google (tokens are verified with locally signed test keys),
SMS/email providers (unit-tested request shaping only). **Docker files have not been built or run** (Docker isn't installed on the
development machine; the compose YAML was only parsed). The development MySQL is 9.7 while the target is 8.x. The Sentry adapter is only tested with a stub and needs `@sentry/node` installed. No load testing has been done.

## Running the whole stack locally (API + worker + website + admin)
```bash
# terminal 1: MySQL + Redis running, then in backend/
npm install && cp .env.example .env            # set DB_PASSWORD and APP_SECRET
npm run migration:run
npm run seed:dev                               # dev admin (password printed once) + 3 sample series (drafts)
MEDIA_PUBLIC_BASE_URL=/api/v1/media npm run start:dev # API  http://localhost:3000
npm run start:worker:dev                       # terminal 2: worker (FFmpeg on PATH)
MEDIA_PUBLIC_BASE_URL=/api/v1/media npm run seed:demo # terminal 3: real FFmpeg-generated demo episodes + publish
# terminal 4: repo root
npm install && npm run dev                     # http://localhost:8443 (site) and /admin (Control Centre)
```
The Vite dev/preview server proxies `/api` to `http://localhost:3000` (override with `VITE_API_TARGET`), so the browser never
needs CORS. Sign in to `/admin` with the dev admin; the first sign-in enrols an authenticator app (MFA is mandatory) and shows
recovery codes once. Viewer sign-in uses a phone OTP: with the dev SMS adapter the website shows the code under "Development
only" (served by `GET /api/v1/dev/outbox`, which does not exist in production or with a real SMS provider).

Frontend ↔ backend wiring: `src/api/` (HTTP client with rotating-refresh handling, typed endpoints), `src/viewer/` (website state,
auth, player, plans) and `src/admin/` (Control Centre). `GET /api/v1/config` tells the website which sign-in methods and payment
mode are really enabled. Google/Apple buttons appear only when the server has client IDs; Apple needs its JS SDK, not wired yet.

Sign-up rules (enforced by the API, mirrored in the website form): every new account needs a name, an email and a date of birth, and
must be at least 14 (`MIN_AGE_YEARS` in `src/common/age.ts`). A new phone number that verifies its OTP without those details gets
`PROFILE_REQUIRED` and finishes via `POST /auth/otp/complete`. Accounts created before the rule have no date of birth on file.

Known gaps: no offline downloads (needs a DRM design; the Downloads page was removed), no image-upload endpoint (posters/banners are uploaded in the admin and served from `MEDIA_PUBLIC_BASE_URL`), no admin episode
reorder endpoint, admin subscription/payment lists show user ids only, Razorpay checkout and
Google sign-in are implemented in the website but untested against the live services.
