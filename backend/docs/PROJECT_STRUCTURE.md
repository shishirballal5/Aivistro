# Project structure (backend)

Each feature is one folder in `src/modules/<name>/` and owns its controller, service, DTOs and **tables** (`*.entities.ts`); every module folder has a README. All third-party calls live in `src/util/thirdparty/`. Files ending `-core.module.ts` are worker-safe (no controllers).

## Top level

| Path | What |
|---|---|
| `src/main.ts`, `src/setup-app.ts` | HTTP API entry and shared web setup |
| `src/worker.ts`, `src/worker.module.ts` | background worker and its processors |
| `src/app.module.ts` | API module composition |
| `src/config/` | env validation and typed config |
| `src/common/` | guards, crypto, errors, filters, logging, throttler, age rule, money/time helpers |
| `src/database/` | shared entity base + registry (`entities/index.ts`), migrations, TypeORM options |
| `src/util/thirdparty/` | all external-service clients |
| `test/` | e2e suites (real MySQL/Redis/FFmpeg) |

## Modules

### [`modules/account-data/`](../src/modules/account-data/README.md): Viewer data rights: `GET /me/export` and `DELETE /me` (erase personal data, keep financial records).
- `modules/account-data/account-data.controller.ts`
- `modules/account-data/account-data.dto.ts`
- `modules/account-data/account-data.module.ts`
- `modules/account-data/account-data.service.ts`

### [`modules/admin/`](../src/modules/admin/README.md): Admin sign-in (password + mandatory TOTP MFA, recovery codes), admin-user and role management, viewer suspend/restore.
- `modules/admin/admin-auth.controller.ts`
- `modules/admin/admin-auth.dto.ts`
- `modules/admin/admin-auth.service.ts`
- `modules/admin/admin-management.controller.ts`
- `modules/admin/admin-users.dto.ts`
- `modules/admin/admin.entities.ts`
- `modules/admin/admin.module.ts`

### [`modules/analytics/`](../src/modules/analytics/README.md): Client event intake and the `/admin/dashboard` queries.
- `modules/analytics/analytics.controller.ts`
- `modules/analytics/analytics.entities.ts`
- `modules/analytics/analytics.module.ts`
- `modules/analytics/analytics.service.ts`
- `modules/analytics/dashboard.service.ts`

### [`modules/audit-logs/`](../src/modules/audit-logs/README.md): Append-only audit trail of admin and security actions, plus the interceptor that records them.
- `modules/audit-logs/audit.decorator.ts`
- `modules/audit-logs/audit.entities.ts`
- `modules/audit-logs/audit.module.ts`
- `modules/audit-logs/audit.service.ts`

### [`modules/auth/`](../src/modules/auth/README.md): Viewer authentication: phone OTP, email + password, Google/Apple, rotating refresh tokens, sessions, age-gated sign-up.
- `modules/auth/auth-core.module.ts`
- `modules/auth/auth.controller.ts`
- `modules/auth/auth.dto.ts`
- `modules/auth/auth.entities.ts`
- `modules/auth/auth.service.ts`
- `modules/auth/otp.service.ts`
- `modules/auth/passwords.service.ts`
- `modules/auth/sessions.service.ts`
- `modules/auth/tokens.service.ts`

### [`modules/catalog/`](../src/modules/catalog/README.md): Genres, categories, cast, series, episodes, homepage sections and banners; publishing rules (an episode needs a READY video).
- `modules/catalog/catalog-admin.controller.ts`
- `modules/catalog/catalog-admin.service.ts`
- `modules/catalog/catalog-core.module.ts`
- `modules/catalog/catalog.controller.ts`
- `modules/catalog/catalog.dto.ts`
- `modules/catalog/catalog.entities.ts`
- `modules/catalog/catalog.module.ts`
- `modules/catalog/catalog.processor.ts`
- `modules/catalog/catalog.service.ts`
- `modules/catalog/catalog.util.ts`
- `modules/catalog/media-urls.service.ts`
- `modules/catalog/publish.policy.ts`

### [`modules/entitlements/`](../src/modules/entitlements/README.md): "May this user watch this episode?" (subscription-only, no free episodes) and the access endpoint.
- `modules/entitlements/access.controller.ts`
- `modules/entitlements/entitlements.module.ts`
- `modules/entitlements/entitlements.service.ts`

### [`modules/health/`](../src/modules/health/README.md): Liveness and readiness probes (MySQL + Redis).
- `modules/health/health.controller.ts`
- `modules/health/health.module.ts`
- `modules/health/redis.health.ts`

### [`modules/monitoring/`](../src/modules/monitoring/README.md): Prometheus metrics, the error-reporter contract, request metrics.
- `modules/monitoring/error-reporter.ts`
- `modules/monitoring/metrics.service.ts`
- `modules/monitoring/monitoring.module.ts`

### [`modules/notifications/`](../src/modules/notifications/README.md): In-app inbox, device tokens, admin campaigns and fan-out, push dispatch.
- `modules/notifications/notifications-core.module.ts`
- `modules/notifications/notifications.controller.ts`
- `modules/notifications/notifications.dto.ts`
- `modules/notifications/notifications.entities.ts`
- `modules/notifications/notifications.module.ts`
- `modules/notifications/notifications.service.ts`

### [`modules/payments/`](../src/modules/payments/README.md): Checkout and quote, verify, signed webhooks, refunds, reconcile/retry. Dev simulator in non-production.
- `modules/payments/payments-admin.controller.ts`
- `modules/payments/payments-core.module.ts`
- `modules/payments/payments.controller.ts`
- `modules/payments/payments.module.ts`
- `modules/payments/payments.processor.ts`
- `modules/payments/payments.service.ts`
- `modules/payments/reason.dto.ts`
- `modules/payments/gateway/dev.gateway.ts`
- `modules/payments/gateway/payment-gateway.ts`

### [`modules/playback/`](../src/modules/playback/README.md): Playback sessions, heartbeat, stream limits, and the token-gated HLS manifest/key/segment delivery.
- `modules/playback/media.controller.ts`
- `modules/playback/playback.controller.ts`
- `modules/playback/playback.entities.ts`
- `modules/playback/playback.module.ts`
- `modules/playback/playback.service.ts`

### [`modules/public-config/`](../src/modules/public-config/README.md): What this deployment really supports (sign-in methods, payment mode) and the dev-only message outbox.
- `modules/public-config/public-config.controller.ts`
- `modules/public-config/public-config.module.ts`

### [`modules/queues/`](../src/modules/queues/README.md): BullMQ queue and job names and the shared registry.
- `modules/queues/queue.constants.ts`
- `modules/queues/queue.module.ts`
- `modules/queues/system-queue.service.ts`
- `modules/queues/system.processor.ts`

### [`modules/redis/`](../src/modules/redis/README.md): Redis client provider.
- `modules/redis/redis.module.ts`

### [`modules/storage/`](../src/modules/storage/README.md): Storage contract with local (dev) and S3/R2 drivers; signed upload authorisations.
- `modules/storage/local-storage.service.ts`
- `modules/storage/local-upload.controller.ts`
- `modules/storage/storage.module.ts`
- `modules/storage/storage.service.ts`

### [`modules/subscriptions/`](../src/modules/subscriptions/README.md): Plans, subscriptions, entitlements (periods), upgrade credit, and ALL billing tables (plans, subscriptions, entitlements, payments, refunds, webhook events).
- `modules/subscriptions/billing.entities.ts`
- `modules/subscriptions/plans.dto.ts`
- `modules/subscriptions/subscriptions-core.module.ts`
- `modules/subscriptions/subscriptions.controller.ts`
- `modules/subscriptions/subscriptions.service.ts`

### [`modules/users/`](../src/modules/users/README.md): Viewer profile endpoints and the user/profile tables.
- `modules/users/user.entities.ts`
- `modules/users/users.controller.ts`
- `modules/users/users.dto.ts`

### [`modules/video-assets/`](../src/modules/video-assets/README.md): Video upload authorisation, FFmpeg processing into encrypted HLS, reprocess, subtitles.
- `modules/video-assets/video-assets-core.module.ts`
- `modules/video-assets/video-assets.controller.ts`
- `modules/video-assets/video-assets.dto.ts`
- `modules/video-assets/video-assets.entities.ts`
- `modules/video-assets/video-assets.module.ts`
- `modules/video-assets/video-assets.service.ts`
- `modules/video-assets/video-processing.service.ts`
- `modules/video-assets/video.processor.ts`

### [`modules/watch-history/`](../src/modules/watch-history/README.md): Watch progress batching, history and continue-watching.
- `modules/watch-history/engagement-core.module.ts`
- `modules/watch-history/engagement.controller.ts`
- `modules/watch-history/engagement.module.ts`
- `modules/watch-history/engagement.processor.ts`
- `modules/watch-history/history.service.ts`
- `modules/watch-history/progress.service.ts`
- `modules/watch-history/watch-history.entities.ts`

### [`modules/watchlist/`](../src/modules/watchlist/README.md): A viewer's saved series.
- `modules/watchlist/watchlist.entities.ts`
- `modules/watchlist/watchlist.service.ts`

## Third-party clients

- `util/thirdparty/aws-s3/s3-storage.service.ts`
- `util/thirdparty/fcm/push.sender.ts`
- `util/thirdparty/ffmpeg/ffmpeg.util.ts`
- `util/thirdparty/razorpay/razorpay.gateway.ts`
- `util/thirdparty/sentry/sentry.reporter.ts`
- `util/thirdparty/sms-email/senders.ts`
- `util/thirdparty/social-login/social.verifier.ts`

## Migrations (`src/database/migrations/`)

- `1791680424234-InitialFoundation.ts`
- `1791781575449-AuthAndCatalog.ts`
- `1791781575450-SeedRbac.ts`
- `1791783460174-SubscriptionsAndPayments.ts`
- `1791783460175-SeedPlansAndPermission.ts`
- `1791784340325-VideoAndPlayback.ts`
- `1791786311034-UserFeatures.ts`
- `1791790000000-ProfileDateOfBirth.ts`
- `1791795000000-UpgradeCredit.ts`
- `1791796000000-UpgradeRestore.ts`
