# AIVISTRO: production readiness checklist

`[x]` = done and verified here · `[ ]` = still to do · **(BLOCKER)** = do not launch without it.
"Verified" means covered by automated tests or run against real MySQL/Redis/FFmpeg in this repo. Nothing below has been run against live third-party services.

---

## 1. Already done (for reference)
- [x] API + separate worker, `/api/v1`, migrations only (`synchronize` can never be on), validated config that refuses to boot on bad values
- [x] Auth: OTP, email+password, rotating refresh tokens with reuse detection, Argon2id, admin MFA mandatory, RBAC with escalation guard, audit log
- [x] Subscription-only access (no free episodes), server-side entitlement checks on every playback session and heartbeat
- [x] Payments: signed webhooks, idempotent activation, refunds, reconcile/retry, upgrade pricing with credit and refund restore
- [x] Video: FFmpeg → AES-128 encrypted HLS, token-gated key and segments, concurrent-stream limit
- [x] Minimum age 14 enforced by the server on every sign-up path
- [x] 134 unit + 358 e2e tests passing; schema/entity diff clean
- [x] Website and admin wired to the real API; responsive audit clean (no overflow, no layout shift)

---

## 2. Third-party services: none tested live **(BLOCKER)**
- [ ] **Razorpay**: live account, KYC, key id/secret + webhook secret, webhook URL registered, one real ₹1 payment + refund end to end
- [ ] **Object storage** (S3 or Cloudflare R2): private bucket for sources + HLS, bucket CORS for browser uploads, lifecycle rules, versioning; run a real upload → playback
- [ ] **SMS provider** for OTP: in India this needs **DLT** sender + template registration before messages deliver. Remove `DEV_FIXED_OTP`
- [ ] **Email provider** for verification/reset mails (domain with SPF, DKIM, DMARC)
- [ ] **Google sign-in** client id (and decide on Apple: not wired at all today)
- [ ] **Push** (FCM): service account, plus web push registration from the site (not built)
- [ ] **Error monitoring**: `npm i @sentry/node`, set `SENTRY_DSN`, trigger a test error

## 3. Secrets and configuration **(BLOCKER)**
- [ ] Generate production `APP_SECRET` (≥32 random bytes) and store it in a secrets manager, never in source control
- [ ] Production `.env` / secret store for DB, Redis, Razorpay, S3 keys; separate from dev
- [ ] `NODE_ENV=production`, `SMS_PROVIDER`/`EMAIL_PROVIDER`/`PAYMENT_GATEWAY`/`PUSH_PROVIDER` not `dev`, `STORAGE_DRIVER=s3`, real `CORS_ORIGINS`, `TRUST_PROXY_HOPS` set to the proxy count
- [ ] Delete dev artefacts: `dev-admin@aivistro.local` account (its password was shown in a chat), demo series/test-pattern videos, `DEV_FIXED_OTP`
- [ ] Rotate any credential that was ever pasted into chat or logs
- [ ] Plan for `APP_SECRET` rotation (no tooling yet; changing it breaks stored admin MFA secrets and HLS keys)

## 4. Infrastructure and deployment
- [ ] Domain, DNS, TLS certificates (website, API, admin)
- [ ] **Docker images built and run**: Dockerfile and `docker-compose.prod.yml` exist but have never been built (Docker was not available here)
- [ ] Managed **MySQL 8** (tested on 9.7 locally): backups, point-in-time recovery, TLS, private network, `DB_SSL=true`
- [ ] Managed **Redis 7** with `maxmemory-policy noeviction`, password, TLS
- [ ] Reverse proxy / load balancer: HTTPS only, HSTS, request size limits, correct forwarded headers
- [ ] Run API ≥2 instances and worker ≥1; set worker stop grace ≥60 s
- [ ] **CDN** in front of video (signed URLs/cookies); today segments are served by presigned redirects after a token check
- [ ] Deploy order scripted: backup → migrate → API → worker

## 5. Security hardening
- [ ] **Security review / penetration test** of auth, payments, playback and admin
- [ ] Decide token storage: the website keeps the refresh token in `localStorage` (XSS risk); consider httpOnly cookies
- [ ] Add a **Content-Security-Policy** and other headers to the website (API already sends Helmet headers)
- [ ] Restrict the admin portal (separate hostname, IP allow-list or VPN, WAF rules)
- [ ] Rate limits reviewed against real traffic; add bot protection to OTP/sign-up
- [ ] Dependency audit: 2 moderate advisories open (`js-yaml` via swagger); add automated scanning
- [ ] Confirm `/api/docs`, `/dev/*` and `/metrics` are off or protected in production

## 6. Payments and billing
- [ ] Refund and cancellation **policy** published and matching what the system does
- [ ] GST: invoices/receipts with GSTIN, tax breakdown, sequential invoice numbers
- [ ] User-facing **payment history / invoices** page (API exists, no UI)
- [ ] Decide downgrade, cancel and renewal behaviour (today: manual extension only, upgrades credit unused time)
- [ ] Admin lists show user ids only: add name/email and filters; subscription and webhook lists are capped at 100 with no pagination
- [ ] Finance reconciliation report against Razorpay settlements
- [ ] Chargeback / dispute handling process

## 7. Content and media
- [ ] Replace demo content: real episodes, posters, banners
- [ ] **Image upload endpoint** (posters/banners are currently pasted `images/…` keys; a key cannot be cleared)
- [ ] Episode **reorder** endpoint (the admin does it with three non-atomic updates)
- [ ] Decide DRM level: AES-128 HLS stops casual download but not a determined ripper
- [ ] Subtitles workflow and languages
- [ ] Storage cost/retention policy for source files vs renditions

## 8. Legal and compliance **(BLOCKER, needs legal advice)**
- [ ] Terms of Service, Privacy Policy, Refund Policy as real pages (the footer text links nowhere)
- [ ] **Children's data (India DPDP Act):** minimum age is 14, but the law treats under-18s as children needing verifiable parental consent. Get legal advice before launch
- [ ] Consent records, data retention, **account deletion and data export** (not built)
- [ ] Existing accounts have no date of birth: decide whether to ask at next login
- [ ] Cookie/analytics notice if required; grievance officer details
- [ ] Content rights and age ratings for every series

## 9. Reliability and operations
- [ ] **Backup and restore drill**: actually restore MySQL and a video from backup
- [ ] Alerts: API errors/latency, failed jobs growing, payment mismatches, disk, DB/Redis down. Metrics endpoint exists; dashboards and alert rules do not
- [ ] Log shipping and retention; confirm no secrets/PII in logs
- [ ] On-call and incident runbook (starter in `docs/OPERATIONS.md`)
- [ ] **Load test** (login, browse, concurrent playback, webhook bursts, many simultaneous transcodes)
- [ ] Capacity plan for the worker (FFmpeg is CPU-bound)
- [ ] Fix: Jest e2e run no longer exits on its own (an open handle appeared after the latest tests)
- [ ] Uptime checks on `/health/ready` and a status page

## 10. Quality and testing
- [ ] **Automated frontend tests**: the browser journeys I ran (viewer, age rule, upgrade, admin) now live in `e2e/` (run with `node e2e/run.mjs`); run them before every release and after every deploy
- [ ] Admin actions only type-checked so far: grant/revoke, plan create/edit, reconcile/recheck, full refund, role-limited admins, escalation errors
- [ ] Test real browsers/devices (Safari HLS, Android Chrome, low bandwidth); only desktop Chrome was driven
- [ ] Accessibility pass (keyboard, screen reader, contrast)
- [ ] User acceptance testing with real people and real (small) payments

## 11. Product polish
- [ ] SEO and sharing: page titles, meta, social images, deep links to a series/episode (links currently copy text only)
- [ ] Email/SMS templates reviewed by a human; notification preferences UI
- [ ] Offline downloads: removed; needs a DRM design if wanted
- [ ] Admin: audit-log date filter, show suspend reason, fix Roles tab for `roles.manage`-only admins
- [ ] Support tooling: user lookup by email/phone, resend verification, manual refunds with notes

## 12. Launch day
- [ ] Final backup, migrations applied, smoke test (sign up → pay ₹1 → watch → refund)
- [ ] Monitoring and alerts live, someone on call
- [ ] Rollback plan tested (previous image + database restore point)
- [ ] Soft launch to a small group before opening up
