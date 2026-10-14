# util/thirdparty - every call to an outside service lives here

One folder per vendor. Modules depend on the *contract* (interface/abstract class in the module) and get the vendor
implementation injected, so to find "where do we talk to X" look here and nowhere else.

| Folder | Vendor | Files | Contract it implements (in modules/) | Wired in |
|---|---|---|---|---|
| `razorpay/` | Razorpay (orders, payment fetch, refunds) | `razorpay.gateway.ts` | `payments/gateway/payment-gateway.ts` | `payments/payments-core.module.ts` |
| `aws-s3/` | AWS S3 / Cloudflare R2 (presigned PUT/GET, stat, delete) | `s3-storage.service.ts` | `storage/storage.service.ts` | `storage/storage.module.ts` |
| `fcm/` | Firebase Cloud Messaging (push) | `push.sender.ts` | `PushSender` in same file | `notifications/notifications-core.module.ts` |
| `sms-email/` | SMS / email HTTP providers | `senders.ts` | `OtpSender`/`EmailSender` in same file | `auth/auth-core.module.ts` |
| `social-login/` | Google & Apple ID-token verification (JWKS fetch) | `social.verifier.ts` | - | `auth/auth-core.module.ts` |
| `sentry/` | Sentry error reporting | `sentry.reporter.ts` | `monitoring/error-reporter.ts` | `monitoring/monitoring.module.ts` |
| `ffmpeg/` | FFmpeg / ffprobe binaries (child processes) | `ffmpeg.util.ts` | - | `video-assets/video-processing.service.ts`, `playback/media.controller.ts` |

Development adapters that talk to nothing external stay with their module: `payments/gateway/dev.gateway.ts`,
`storage/local-storage.service.ts`.

Adding a vendor: create `util/thirdparty/<vendor>/`, implement the module's contract there, register it in the module's
`*-core.module.ts` factory, add its env vars to `config/env.validation.ts` and `.env.example`, and add a row above.
