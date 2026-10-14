# entitlements

"May this user watch this episode?" (subscription-only, no free episodes) and the access endpoint.

| | |
|---|---|
| **HTTP routes** | `GET /episodes/:id/access` |
| **Tables it owns** | (reads subscription tables) |
| **Depends on** | subscriptions, video-assets |
| **Background jobs** | - |

Files: `access.controller.ts`, `entitlements.module.ts`, `entitlements.service.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
