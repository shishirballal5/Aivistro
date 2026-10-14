# media-images

Admin upload of PUBLIC catalog images (series poster/banner, episode thumbnail, cast photo, homepage banner) plus dev-only public serving.

| | |
|---|---|
| **HTTP routes** | `POST /admin/images`, `POST /admin/images/complete` (catalog.write, audited, 60/min); public `GET /media/images/*` (local driver only) |
| **Tables it owns** | - (state is the object itself; a short-lived Redis note holds the declared size/type) |
| **Depends on** | storage (StorageService), catalog (MediaUrlService), redis |
| **Background jobs** | - |

## Flow (mirrors the video upload)
1. `POST /admin/images {filename, contentType: image/jpeg|png|webp, sizeBytes <= 5 MB}` returns `{key, upload:{url, method:"PUT", headers, expiresAt}}`. The key (`images/<yyyy>/<mm>/<24 random chars>.<ext>`) is server-chosen; the filename is only validated, never used.
2. The browser PUTs the bytes to `upload.url` with the returned headers (15 minute, single-object, write-only authorisation; local driver also refuses a second PUT to the same key).
3. `POST /admin/images/complete {key}` does not trust the client: it stats the object, compares the size with what was declared and the 5 MB cap, and reads the first bytes: JPEG `FFD8FF`, PNG `89504E470D0A1A0A`, WEBP `RIFF....WEBP`. On mismatch the object is deleted and the reply is 400 (`IMAGE_CONTENT_MISMATCH` / `UPLOAD_SIZE_MISMATCH`). Success returns `{key, url}`; `url` comes from `MediaUrlService.imageUrl`. Calling it again re-verifies and returns the same answer.
4. Save the returned `key` as `posterKey`/`bannerKey`/`thumbnailKey`/`photoKey`/banner `imageKey`. Send `null` for the first four to remove an image.

An image that is never completed or never referenced is not cleaned up (no housekeeping yet).

## Serving
- `STORAGE_DRIVER=local` (dev): `GET /api/v1/media/images/...` serves only `images/` keys with a fixed Content-Type from the extension, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=31536000, immutable`. Traversal, absolute paths, directories and non-image extensions are 404. Set `MEDIA_PUBLIC_BASE_URL=/api/v1/media` (or the full origin) in development.
- `STORAGE_DRIVER=s3`: that route is a 404. Images are served by the bucket/CDN at `MEDIA_PUBLIC_BASE_URL`. Needed there:
  - Bucket policy: public `s3:GetObject` ONLY on `arn:aws:s3:::<bucket>/images/*` (everything under `private/` stays private; or serve `images/*` through a CDN with origin access and keep the bucket private). Block listing (`s3:ListBucket`) for the public.
  - CORS on the bucket for the admin origin: `AllowedMethods: PUT`, `AllowedHeaders: Content-Type` (and any `x-amz-*` headers returned in `upload.headers`), `ExposeHeaders: ETag`, `AllowedOrigins: https://<admin origin>`.
  - The CDN should serve `Content-Type` from the object metadata and add `X-Content-Type-Options: nosniff`.
- S3 behaviour is covered by tests only up to presigned-URL generation; it has not been run against a live bucket. Unlike the local driver, S3 cannot refuse a second PUT within the 15 minute window, so the verification in step 3 is the control.
