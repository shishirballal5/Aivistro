# watch-history

Watch progress batching, history and continue-watching.

| | |
|---|---|
| **HTTP routes** | `/episodes/:id/progress`, `/me/history`, `/me/continue-watching` |
| **Tables it owns** | watch_progress, watch_history |
| **Depends on** | catalog |
| **Background jobs** | progress flush (engagement queue) |

Files: `engagement-core.module.ts`, `engagement.controller.ts`, `engagement.module.ts`, `engagement.processor.ts`, `history.service.ts`, `progress.service.ts`, `watch-history.entities.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
