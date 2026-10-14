# queues

BullMQ queue and job names and the shared registry.

| | |
|---|---|
| **HTTP routes** | - |
| **Tables it owns** | - |
| **Depends on** | redis |
| **Background jobs** | - |

Files: `queue.constants.ts`, `queue.module.ts`, `system-queue.service.ts`, `system.processor.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
