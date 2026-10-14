# storage

Storage contract with local (dev) and S3/R2 drivers; signed upload authorisations.

| | |
|---|---|
| **HTTP routes** | `PUT /storage/local/:token` (dev; `images/` keys are write-once) |
| **Tables it owns** | - |
| **Depends on** | util/thirdparty/aws-s3 |
| **Background jobs** | - |

Files: `local-storage.service.ts`, `local-upload.controller.ts`, `storage.module.ts`, `storage.service.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
