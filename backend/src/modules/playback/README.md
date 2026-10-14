# playback

Playback sessions, heartbeat, stream limits, and the token-gated HLS manifest/key/segment delivery.

| | |
|---|---|
| **HTTP routes** | `/episodes/:id/playback-session`, `/playback-sessions/*`, `/media/hls/:token/*` |
| **Tables it owns** | playback_sessions |
| **Depends on** | entitlements, video-assets, storage |
| **Background jobs** | session cleanup |

Files: `media.controller.ts`, `playback.controller.ts`, `playback.entities.ts`, `playback.module.ts`, `playback.service.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
