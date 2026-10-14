# analytics

Client event intake and the `/admin/dashboard` queries.

| | |
|---|---|
| **HTTP routes** | `POST /analytics/events`, `GET /admin/dashboard` |
| **Tables it owns** | analytics_events |
| **Depends on** | auth guards, redis cache |
| **Background jobs** | retention prune (system queue) |

Files: `analytics.controller.ts`, `analytics.entities.ts`, `analytics.module.ts`, `analytics.service.ts`, `dashboard.service.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
