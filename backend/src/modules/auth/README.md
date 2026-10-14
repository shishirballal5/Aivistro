# auth

Viewer authentication: phone OTP, email + password, Google/Apple, rotating refresh tokens, sessions, age-gated sign-up.

| | |
|---|---|
| **HTTP routes** | `/auth/*`, `/me` |
| **Tables it owns** | otp_challenges, auth_sessions, refresh_tokens, email_tokens |
| **Depends on** | users, util/thirdparty/sms-email, social-login |
| **Background jobs** | - |

Files: `auth-core.module.ts`, `auth.controller.ts`, `auth.dto.ts`, `auth.entities.ts`, `auth.service.ts`, `otp.service.ts`, `passwords.service.ts`, `sessions.service.ts`, `tokens.service.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
