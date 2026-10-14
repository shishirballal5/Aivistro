# monitoring

Prometheus metrics, the error-reporter contract, request metrics.

| | |
|---|---|
| **HTTP routes** | `GET /metrics` (token-protected) |
| **Tables it owns** | - |
| **Depends on** | util/thirdparty/sentry |
| **Background jobs** | - |

Files: `error-reporter.ts`, `metrics.service.ts`, `monitoring.module.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
