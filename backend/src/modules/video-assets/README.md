# video-assets

Video upload authorisation, FFmpeg processing into encrypted HLS, reprocess, subtitles.

| | |
|---|---|
| **HTTP routes** | `/admin/episodes/:id/video-assets`, `/admin/video-assets/*` |
| **Tables it owns** | video_assets, video_subtitles |
| **Depends on** | storage, util/thirdparty/ffmpeg |
| **Background jobs** | video transcoding (video-processing queue) |

Files: `video-assets-core.module.ts`, `video-assets.controller.ts`, `video-assets.dto.ts`, `video-assets.entities.ts`, `video-assets.module.ts`, `video-assets.service.ts`, `video-processing.service.ts`, `video.processor.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
