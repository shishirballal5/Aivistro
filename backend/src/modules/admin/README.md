# admin

Admin sign-in (password + mandatory TOTP MFA, recovery codes), admin-user and role management, viewer suspend/restore.

| | |
|---|---|
| **HTTP routes** | `/admin/auth/*`, `/admin/admin-users`, `/admin/roles`, `/admin/permissions`, `/admin/users` |
| **Tables it owns** | admin_users, roles, permissions (+ join tables) |
| **Depends on** | auth (sessions, tokens), audit-logs |
| **Background jobs** | - |

Files: `admin-auth.controller.ts`, `admin-auth.dto.ts`, `admin-auth.service.ts`, `admin-management.controller.ts`, `admin-users.dto.ts`, `admin.entities.ts`, `admin.module.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.

## Notes
- `POST /admin/users/:id/suspend` stores the optional `reason` (and `suspended_at`); user list/detail return `suspendedReason`. Sessions are still revoked at once.
- `GET /admin/roles` needs `admins.manage` OR `roles.manage` (`RequireAnyPermission` in `common/auth/guards.ts`; `RequirePermissions` still means ALL).
- `GET /admin/audit-logs` filters: `action`, `entityType`, `entityId`, `actorType`, `actorId` (digits), `from`/`to` (ISO 8601, inclusive; a bare date covers the whole UTC day; `from` > `to` is 400). Cursor-paged.
- Deleted viewers appear as tombstones (`status: DELETED`, name `Deleted user`, no email/phone, `deletedAt`).
