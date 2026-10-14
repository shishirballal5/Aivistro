# payments

Checkout and quote, verify, signed webhooks, refunds, reconcile/retry. Dev simulator in non-production.

| | |
|---|---|
| **HTTP routes** | `/subscriptions/checkout|verify|quote`, `/payments/*`, `/admin/payments*` |
| **Tables it owns** | (billing tables live in subscriptions/billing.entities.ts) |
| **Depends on** | subscriptions, util/thirdparty/razorpay |
| **Background jobs** | reconcile, webhook retry (payments queue) |

Files: `payments-admin.controller.ts`, `payments-core.module.ts`, `payments.controller.ts`, `payments.module.ts`, `payments.processor.ts`, `payments.service.ts`, `reason.dto.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.

## Admin list shapes
- `GET /admin/payments` and `/admin/payments/:id` rows carry `user: { id, displayName, email, phone } | null` (one batched lookup).
- `GET /admin/subscriptions` (filters `status`, `userId`, `planCode`, `q` over name/email/phone) and `GET /admin/webhook-events` (filters `status`, `eventType`) are cursor-paged, max 100. Passing `limit` or `cursor` returns `{ items, nextCursor }`; with neither they keep the legacy bare array (newest 100).
