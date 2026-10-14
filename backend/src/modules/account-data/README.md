# account-data

Viewer data rights (India DPDP / GDPR style): download everything we hold, and delete the account.

| | |
|---|---|
| **HTTP routes** | `GET /me/export` (rate limited, `Cache-Control: private, no-store`), `DELETE /me` |
| **Tables it owns** | none (reads and erases rows owned by users, auth, billing, watch-history, watchlist, notifications) |
| **Depends on** | auth (guards, sessions, passwords), audit-logs |
| **Background jobs** | - |

Files: `account-data.controller.ts`, `account-data.service.ts`, `account-data.dto.ts`, `account-data.module.ts`

## Export
One JSON document: `generatedAt`, profile, identities (provider only), sessions summary, subscriptions, payments (paise + display), refunds, watch history/progress, watchlist, notification inbox, devices (platform only). Never selected: password hash, token hashes, social subjects, device tokens, gateway order ids. Lists are capped at 5000 rows each.

## Delete: `DELETE /me` `{ confirm: "DELETE", password?, acknowledgeLostAccess? }`
1. **Proof of ownership.** Accounts with a password must send it (`403 PASSWORD_INCORRECT`). Phone/social-only accounts have no secret to ask for, so the session making the request must have been *created* (a real OTP or social sign-in, not a refresh) within 10 minutes (`403 REAUTH_REQUIRED`). Refreshing does not renew that time.
2. **Paid-subscription guard.** An ACTIVE `PURCHASE` subscription refuses with `409 ACTIVE_SUBSCRIPTION` unless `acknowledgeLostAccess: true`; remaining time is NOT refunded automatically. Admin grants do not count as paid. Re-checked under a row lock.
3. **One transaction:** delete sessions (so every access token dies) and refresh tokens, email tokens, OTP challenges, identities, devices, inbox, watch progress/history, watchlist; stop playback sessions and strip their IP/user agent; null analytics `user_id`; profile becomes `Deleted user` (no avatar/date of birth); the user row is nulled (`phone`, `email`, `password_hash`, verification times), `status = DELETED`, `deleted_at` set.
4. **Kept:** payments, refunds, subscriptions, entitlements (financial records), still pointing at the tombstone user row.
5. **Audit:** `account.delete` with the tombstone id only (no IP, email or name).
6. The same phone/email can register again: the unique columns are NULL now, so it is a brand-new account.
