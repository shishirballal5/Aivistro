# users

Viewer profile endpoints and the user/profile tables.

| | |
|---|---|
| **HTTP routes** | `/me/profile`, `/me/sessions` |
| **Tables it owns** | users, profiles, user_identities |
| **Depends on** | auth |
| **Background jobs** | - |

Files: `user.entities.ts`, `users.controller.ts`, `users.dto.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.

## Added
- `users` gained `suspended_reason`, `suspended_at` (set by `POST /admin/users/:id/suspend`, cleared on restore) and `deleted_at` (self-service deletion, see `account-data`).
- `GET /me` now includes `hasPassword` (the delete dialog asks for a password only when there is one).
- `user-brief.ts`: `loadUserBriefs()`, the batched `{ id, displayName, email, phone }` lookup admin lists use.
