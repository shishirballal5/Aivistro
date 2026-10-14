# public-config

What this deployment really supports (sign-in methods, payment mode) and the dev-only message outbox.

| | |
|---|---|
| **HTTP routes** | `GET /config`, `GET /dev/outbox` (dev only) |
| **Tables it owns** | - |
| **Depends on** | auth config, payments config |
| **Background jobs** | - |

Files: `public-config.controller.ts`, `public-config.module.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
