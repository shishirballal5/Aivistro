# AIVISTRO backend - operations guide

## Processes
| Process | Command | Notes |
|---|---|---|
| API | `node dist/main.js` | stateless; scale horizontally (rate limiter state is in Redis) |
| Worker | `node dist/worker.js` | BullMQ processors + schedulers (video transcode, payment reconcile/retry, notifications fan-out, watch-progress flush, retention). Needs FFmpeg. Run >= 1 |
| Migrate | `npm run migration:run:prod` | one-shot, from compiled `dist/` |

## Deploy order
1. Back up MySQL (see Backups).
2. Run migrations (`migrate` service / `npm run migration:run:prod`). Migrations never run on boot and `synchronize` cannot be enabled.
3. Roll the API, then the worker. Workers get SIGTERM -> finish in-flight jobs (give them 60 s) -> exit.
4. Check `GET /api/v1/health/ready` (MySQL + Redis) and, if `METRICS_TOKEN` is set, `/api/v1/metrics`.

Migrations should be backward compatible with the previous release for one deploy (add columns/tables first, remove later), so API and worker can roll without downtime.

## First admin (never seeded with default credentials)
`ADMIN_EMAIL=... [ADMIN_NAME=...] npm run admin:create:prod` creates a SUPER_ADMIN. If `ADMIN_PASSWORD` is unset a random password is generated and printed once (it must pass the strength check). The admin must enrol MFA on first login; MFA is mandatory. `seed:dev` is for local data only and refuses production.

## Required production configuration
The process refuses to start if any of these is violated: `APP_SECRET` (>= 32 random chars, not a placeholder), `DB_PASSWORD`, no `*` in `CORS_ORIGINS`, and no `dev` SMS/EMAIL/PAYMENT/PUSH providers or `local` storage. Set `TRUST_PROXY_HOPS` to the number of proxies in front of the API, otherwise rate limiting sees the proxy IP. Terminate TLS at the proxy/load balancer.

## Failed jobs
Failed jobs are retained 7 days in BullMQ's *failed* set per queue (`system`, `catalog`, `payments`, `video-processing`, `engagement`). There is no separate dead-letter queue. To inspect/retry use any BullMQ UI (e.g. bull-board pointed at the same Redis) or `queue.getFailed()` / `job.retry()`. Queue depth per state is exported as `aivistro_queue_jobs{queue,state}`; alert on a growing `failed` or `waiting` count.
- Video asset in `FAILED`: the reason is on the asset (admin video endpoint). Fix the source and re-upload / reprocess; the previous good rendition keeps playing meanwhile.
- Payment stuck: the reconcile job re-checks pending orders against the gateway; webhooks are idempotent, so replaying a webhook from the Razorpay dashboard is safe.

## Backups and restore
- **MySQL (daily full copy):** `backend/scripts/backup-mysql.sh` takes a consistent snapshot (`--single-transaction`), **proves the dump is complete** (checks mysqldump's end marker, otherwise deletes it and fails), and can encrypt it (`BACKUP_PASSPHRASE`, AES-256; store the passphrase apart from the backups). It prints only the file path on stdout, so `FILE=$(./scripts/backup-mysql.sh /backups)` is safe in cron. Add point-in-time recovery (binary logs or your provider's PITR) for the hours between copies.
- **Restore:** `backend/scripts/restore-mysql.sh <file>` restores into `TARGET_DB`. It refuses to overwrite a non-empty database unless `FORCE=yes`, and fails on a wrong passphrase. Run it as a privileged user, not the app's runtime user.
- **Drill (done 14 Oct 2026 on the demo database):** encrypted backup -> restore into a scratch database -> 43 tables, every row count identical, payment totals identical, zero schema differences; overwrite protection and wrong-passphrase failure verified. The drill also caught two real defects in the scripts, now fixed. Repeat it against production-sized data on a schedule: a backup you have never restored is not a backup.
- **Object storage:** enable bucket versioning. Source uploads and HLS output are reproducible from the sources, so keep the sources.
- **Redis** holds queues, caches, rate-limit counters and un-flushed watch progress. Losing it loses at most a few seconds of progress and not-yet-run jobs; pending payments are recovered by reconciliation. Keep `maxmemory-policy noeviction`.

## APP_SECRET rotation - read before changing
Every key is derived from `APP_SECRET`. Changing it:
- invalidates all access tokens and OTP/verification codes (users re-login);
- makes **stored admin MFA secrets and per-video HLS keys undecryptable** (admins lose MFA, existing encrypted HLS can't be played).
There is no online rotation tooling yet. A safe rotation requires a re-encryption migration (decrypt with old, encrypt with new) which is not implemented. Treat a leaked secret as an incident (below).

## Scaling
API: add instances. Worker: add instances (BullMQ distributes jobs; transcoding is CPU bound, concurrency is per process). MySQL: read replicas are not wired in. Segments are served through short-lived presigned S3 redirects after token checks; the planned upgrade for high traffic is CDN signed cookies/URLs in front of the bucket (not implemented).

## Monitoring
- Liveness `/api/v1/health/live`, readiness `/api/v1/health/ready`.
- Prometheus `/api/v1/metrics` (bearer `METRICS_TOKEN`; absent -> 404). Labels use route patterns, so cardinality is bounded.
- Errors: 5xx are logged with `requestId` and sent to Sentry when `SENTRY_DSN` is set (`@sentry/node` is installed; the adapter strips query strings, sends no personal data, and can never break a request; covered by unit tests, **not yet run against a real Sentry project**). Trigger one test error after deploying.
- Audit log (`audit_logs`) records admin actions, payment/refund and auth-security events; secrets are sanitised.

## Incident response (short form)
- **Leaked APP_SECRET / DB / Razorpay / S3 credentials:** rotate the external credential immediately, deploy, then assess APP_SECRET impact above.
- **Compromised user:** admin API can revoke sessions (suspend account). Refresh-token reuse already revokes the whole session automatically.
- **Compromised admin:** disable the admin account (SUPER_ADMIN), revoke sessions, review `audit_logs`.
- **Payment dispute:** use `/admin/payments/:id/refund`; amounts are integer paise and refunds are locked against over-refund.

## Public images (posters, banners, thumbnails)
Admins upload through `POST /admin/images` then `POST /admin/images/complete` (see `src/modules/media-images/README.md`). With `STORAGE_DRIVER=s3`:
- Set `MEDIA_PUBLIC_BASE_URL` to the CDN/bucket origin that serves `images/*` publicly. The API's `/media/images/*` route is a 404 in this mode.
- Bucket policy: allow anonymous `s3:GetObject` on `images/*` only; never on `private/*` (video sources, HLS, subtitles). Do not allow public listing.
- Bucket CORS for the admin origin: `PUT` with header `Content-Type`, `ExposeHeaders: ETag`.
- Uploaded-but-unreferenced images are not garbage collected; a lifecycle rule or a periodic sweep can be added later.
- Not verified against a live bucket in tests (presigned URL generation only).

## Web tier, security headers and alerts
- **nginx** (`deploy/nginx/aivistro.conf`): TLS, HSTS, the Content-Security-Policy, the proxy to the API (`TRUST_PROXY_HOPS=1`), cache rules, `/metrics` restricted, API docs blocked. The same CSP is in `public/_headers` for hosts that read it; a script check keeps them identical. The policy was exercised against the real site (video playback, payment and sign-in flows) with zero violations, and it blocks injected inline scripts, foreign scripts and foreign connections.
- **Production env template:** `deploy/env/production.env.example` (every required variable; the app refuses to boot if a production rule is broken).
- **Alerts:** `deploy/monitoring/prometheus.yml` and `alerts.yml` use only metrics the API really exports (down, 5xx rate, p95 latency, webhook rejections, queue backlog, failed jobs, restarts). Thresholds are starting points: tune after a load test on production-like infrastructure.
- **Load test:** `loadtest/` (k6). The first run (one laptop, local storage) passed with no errors; it is a correctness check, not a capacity figure.

## Viewer data rights
- `GET /api/v1/me/export` returns the viewer's own data as JSON; `DELETE /api/v1/me` anonymises the account (payments, refunds and subscriptions are kept for accounting, unlinked from identity). Support can see tombstones in the admin. See `src/modules/account-data/README.md` for exactly what is removed and kept. Set the legal retention period with your lawyer.
