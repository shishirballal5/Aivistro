# notifications

In-app inbox, device tokens, admin campaigns and fan-out, push dispatch.

| | |
|---|---|
| **HTTP routes** | `/me/notifications*`, `/me/devices`, `/admin/notifications` |
| **Tables it owns** | notifications, user_notifications, device_tokens |
| **Depends on** | util/thirdparty/fcm |
| **Background jobs** | campaign fan-out (engagement queue) |

Files: `notifications-core.module.ts`, `notifications.controller.ts`, `notifications.dto.ts`, `notifications.entities.ts`, `notifications.module.ts`, `notifications.service.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
