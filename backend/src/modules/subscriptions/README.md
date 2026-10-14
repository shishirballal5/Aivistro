# subscriptions

Plans, subscriptions, entitlements (periods), upgrade credit, and ALL billing tables (plans, subscriptions, entitlements, payments, refunds, webhook events).

| | |
|---|---|
| **HTTP routes** | `GET /plans`, `/subscriptions/me|cancel` |
| **Tables it owns** | subscription_plans, subscriptions, entitlements, payments, refunds, payment_webhook_events |
| **Depends on** | payments (for checkout) |
| **Background jobs** | expire elapsed subscriptions |

Files: `billing.entities.ts`, `plans.dto.ts`, `subscriptions-core.module.ts`, `subscriptions.controller.ts`, `subscriptions.service.ts`

Tables are defined in this module's `*.entities.ts` and registered in `src/database/entities/index.ts`. Migrations are central in `src/database/migrations/`.
