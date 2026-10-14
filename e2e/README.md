# Browser journeys (Playwright + Chrome)

Real Chrome drives the real website and admin against a real running stack (API + worker + MySQL + Redis + FFmpeg). They cover:
`viewer-journey` (sign up, paywall, pay, **encrypted video plays**, watchlist), `viewer-email` (email verification, reset, failed payment),
`age-rule` (minimum age 14), `upgrade` (monthly -> annual pays the difference), `admin-smoke` (MFA login, every admin page),
`responsive-audit` (desktop/tablet/phone: no overflow, no layout shift) and `csp-check` (the security policy really blocks injected code).

```bash
# 1. a stack with the dev adapters and seeded content (see backend/README.md "Running the whole stack locally")
# 2. an admin with an enrolled authenticator (the admin portal requires MFA):
cd backend && ADMIN_EMAIL=e2e-admin@example.com ADMIN_PASSWORD='Choose-A-Strong-One-9' npm run admin:create && cd ..
export E2E_ADMIN_EMAIL=e2e-admin@example.com E2E_ADMIN_PASSWORD='Choose-A-Strong-One-9'
export E2E_ADMIN_TOTP_SECRET=$(node e2e/tools/enrol-admin.mjs "$E2E_ADMIN_EMAIL" "$E2E_ADMIN_PASSWORD")
# 3. run
BASE=http://localhost:5173 node e2e/run.mjs            # all journeys;  node e2e/run.mjs upgrade age-rule  for some
```
- Chrome (not bundled Chromium) is required for video: it has the H.264/AAC decoders. Override with `E2E_CHANNEL` / `E2E_EXECUTABLE`; `E2E_HEADED=1` to watch.
- The sign-up and API calls are rate limited per IP (by design). Running the whole suite repeatedly in a minute can trip them; wait a minute or relax the limits for the test stack (`AUTH_RATE_LIMIT_SCALE=1000`).
- `csp-check` only runs when the site is served WITH its security headers (the dev server sends none). Serve the production build behind `deploy/nginx/aivistro.conf` or a host that reads `public/_headers`.
- Failure screenshots land in `e2e/screenshots/`.
