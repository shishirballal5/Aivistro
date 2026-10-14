# AIVISTRO

A short-drama streaming platform: a website for viewers, a Control Centre for admins, and a NestJS backend.

| Part | Where | What |
|---|---|---|
| Website + admin | `src/` (React 19, Vite, Tailwind) | viewer site at `/`, admin portal at `/admin` (separate app, MFA login) |
| Backend | `backend/` (NestJS, MySQL, Redis, BullMQ, FFmpeg) | API + separate worker; every tables/controller/service lives in its module folder, see `backend/docs/PROJECT_STRUCTURE.md` |
| Browser tests | `e2e/` | Playwright journeys on real Chrome, see `e2e/README.md` |
| Load test | `loadtest/` | k6, see `loadtest/README.md` |
| Deployment | `deploy/`, `backend/Dockerfile`, `backend/docker-compose.prod.yml` | nginx + security headers, production env template, Prometheus alerts |

## Run it locally
See **backend/README.md** ("Running the whole stack locally"): MySQL + Redis, `npm run migration:run`, seed, API, worker, then `npm run dev` here.

## Before launch
`backend/docs/PRODUCTION_CHECKLIST.md` lists everything still open (real payment/SMS/email/storage accounts, legal text, hosting, drills).
`backend/docs/OPERATIONS.md` covers deploys, backups and restores, failed jobs, incident response.
The legal pages in `public/legal/` are **drafts** with placeholders and need a lawyer.
