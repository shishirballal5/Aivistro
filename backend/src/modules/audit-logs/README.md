# audit-logs

Append-only audit trail of admin and security actions, plus the interceptor that records them.

| | |
|---|---|
| **HTTP routes** | `GET /admin/audit-logs` |
| **Tables it owns** | audit_logs |
| **Depends on** | - |
| **Background jobs** | - |

Files: `audit.decorator.ts`, `audit.entities.ts`, `audit.module.ts`, `audit.service.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.

## Reading
`GET /admin/audit-logs` (served by the admin module) filters by action prefix, entity, actor type, `actorId` and a `from`/`to` date range; see `modules/admin/README.md`. `account.delete` entries carry no personal data.
