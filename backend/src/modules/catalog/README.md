# catalog

Genres, categories, cast, series, episodes, homepage sections and banners; publishing rules (an episode needs a READY video).

| | |
|---|---|
| **HTTP routes** | public: `/home`, `/series*`, `/genres`; admin: `/admin/series`, `/admin/episodes`, `/admin/banners`, ... |
| **Tables it owns** | genres, categories, cast_members, series, series_cast, episodes, homepage_sections(+items), banners |
| **Depends on** | video-assets (publish rule), entitlements (per-episode access) |
| **Background jobs** | scheduled publish (catalog queue) |

Image fields (`posterKey`, `bannerKey`, `thumbnailKey`, cast `photoKey`) accept a key from `POST /admin/images` or an explicit `null` to remove the image; banner `imageKey` is required. Admin series views return `posterUrl` and `bannerUrl`. `POST /admin/series/:id/episodes/reorder {episodeIds}` renumbers 1..n atomically (series row locked; list must be exactly the series' episodes; status untouched).

Files: `catalog-admin.controller.ts`, `catalog-admin.service.ts`, `catalog-core.module.ts`, `catalog.controller.ts`, `catalog.dto.ts`, `catalog.entities.ts`, `catalog.module.ts`, `catalog.processor.ts`, `catalog.service.ts`, `catalog.util.ts`, `media-urls.service.ts`, `publish.policy.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
