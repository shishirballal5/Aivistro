# health

Liveness and readiness probes (MySQL + Redis).

| | |
|---|---|
| **HTTP routes** | `/health/live`, `/health/ready` |
| **Tables it owns** | - |
| **Depends on** | database, redis |
| **Background jobs** | - |

Files: `health.controller.ts`, `health.module.ts`, `redis.health.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
