# watchlist

A viewer's saved series.

| | |
|---|---|
| **HTTP routes** | `/me/watchlist*` |
| **Tables it owns** | watchlists, watchlist_items |
| **Depends on** | catalog |
| **Background jobs** | - |

Files: `watchlist.entities.ts`, `watchlist.service.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
