import { adminRequest } from "./admin";
import { API_BASE } from "./http";

/* Money is integer PAISE on the wire. These helpers never use floats for the value itself. */

/** "149", "149.5", "149.50" -> 14950. Returns null for anything else (negative, >2 decimals, empty, junk). */
export function rupeesToPaise(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
/** 14950 -> "149.50" (string math, no float division). */
export function paiseToRupeeText(paise: number): string {
  const p = Math.round(paise);
  return `${Math.floor(p / 100)}.${String(p % 100).padStart(2, "0")}`;
}
export const formatPaise = (paise: number) => `₹${Math.floor(paise / 100).toLocaleString("en-IN")}.${String(Math.round(paise) % 100).padStart(2, "0")}`;

export type Page<T> = { items: T[]; nextCursor: string | null };

export type UserStatus = "ACTIVE" | "SUSPENDED" | "DELETED";
export type UserRow = { id: string; displayName: string | null; email: string | null; phone: string | null; status: UserStatus; suspendedReason?: string | null; createdAt: string; lastLoginAt: string | null };
export type UserDetail = UserRow & { emailVerified: boolean; phoneVerified: boolean; suspendedAt?: string | null; deletedAt?: string | null };
/** Compact "who" block on admin lists. Null when the user row no longer exists; a deleted account has name "Deleted user" and no contact. */
export type UserBrief = { id: string; displayName: string | null; email: string | null; phone: string | null };

export type Plan = { id: string; code: string; name: string; description: string; durationMonths: number; pricePaise: number; priceDisplay: string; currency: string; active: boolean; sortOrder: number };
export type PlanInput = { code: string; name: string; description?: string; durationMonths: number; pricePaise: number; sortOrder?: number };
export type PlanPatch = { name?: string; description?: string; pricePaise?: number; active?: boolean; sortOrder?: number };

export type SubscriptionStatus = "ACTIVE" | "EXPIRED" | "CANCELLED" | "REFUNDED";
export type SubscriptionRow = { id: string; planName: string | null; status: SubscriptionStatus; source: "PURCHASE" | "ADMIN_GRANT"; startsAt: string; endsAt: string; cancelAtPeriodEnd: boolean; cancelledAt: string | null; userId: string; user: UserBrief | null; planCode: string | null; paymentId: string | null; grantReason: string | null };

export type PaymentStatus = "CREATED" | "CAPTURED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
export type PaymentRow = { id: string; planCode: string; durationMonths: number; amountPaise: number; amountDisplay: string; currency: string; status: PaymentStatus; method: string | null; failureReason: string | null; createdAt: string; capturedAt: string | null; refundedPaise: number; creditPaise?: number; upgrade?: boolean; userId: string; user: UserBrief | null; providerOrderId: string; providerPaymentId: string | null; provider: string };
export type RefundRow = { id: string; paymentId: string; providerRefundId: string | null; amountPaise: number; amountDisplay: string; reason: string; status: "PENDING" | "PROCESSED" | "FAILED"; failureReason: string | null; processedAt: string | null; paymentStatus: PaymentStatus };
export type WebhookStatus = "RECEIVED" | "PROCESSED" | "IGNORED" | "FAILED";
export type WebhookRow = { id: string; provider?: string; providerEventId?: string; eventType: string; status: WebhookStatus; attempts: number; note: string | null; createdAt: string; processedAt?: string | null };
export type PaymentDetail = PaymentRow & { refunds: RefundRow[]; subscriptionId: string | null; webhookEvents: WebhookRow[] };

/** Name + email (or phone) for a list row; falls back to the id. */
export const personLabel = (user: UserBrief | null | undefined, userId: string) => ({ name: user?.displayName || user?.email || user?.phone || `User #${userId}`, contact: [user?.email, user?.phone].filter(Boolean).join(" · ") });

export type SubscriptionQuery = { userId?: string; status?: string; planCode?: string; q?: string; cursor?: string | null };
export type WebhookQuery = { status?: string; eventType?: string; cursor?: string | null };

const q = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Record<string, string>;

export const billingApi = {
  users: (p: { q?: string; status?: string; cursor?: string | null }) => adminRequest<Page<UserRow>>("/admin/users", { query: { ...q({ q: p.q, status: p.status, cursor: p.cursor ?? undefined }), limit: 20 } }),
  user: (id: string) => adminRequest<UserDetail>(`/admin/users/${id}`),
  suspend: (id: string, reason?: string) => adminRequest<{ id: string; status: UserStatus }>(`/admin/users/${id}/suspend`, { method: "POST", body: reason ? { reason } : {} }),
  restore: (id: string) => adminRequest<{ id: string; status: UserStatus }>(`/admin/users/${id}/restore`, { method: "POST" }),

  /** All plans incl. inactive (plans.manage). */
  plans: () => adminRequest<Plan[]>("/admin/plans"),
  /** Public, active plans only: usable by admins who lack plans.manage. */
  publicPlans: () => adminRequest<Plan[]>("/plans", { auth: "none" }),
  createPlan: (b: PlanInput) => adminRequest<Plan>("/admin/plans", { method: "POST", body: b }),
  updatePlan: (id: string, b: PlanPatch) => adminRequest<Plan>(`/admin/plans/${id}`, { method: "PATCH", body: b }),

  /** `limit` makes the server answer with { items, nextCursor } (max 100). */
  subscriptions: (p: SubscriptionQuery = {}) => adminRequest<Page<SubscriptionRow>>("/admin/subscriptions", { query: { ...q({ userId: p.userId, status: p.status, planCode: p.planCode, q: p.q, cursor: p.cursor ?? undefined }), limit: 25 } }),
  grant: (userId: string, planCode: string, reason: string) => adminRequest<unknown>(`/admin/users/${userId}/grant-subscription`, { method: "POST", body: { planCode, reason } }),
  revoke: (id: string, reason: string) => adminRequest<{ id: string; status: string }>(`/admin/subscriptions/${id}/revoke`, { method: "POST", body: { reason } }),

  payments: (p: { status?: string; userId?: string; cursor?: string | null }) => adminRequest<Page<PaymentRow>>("/admin/payments", { query: { ...q({ status: p.status, userId: p.userId, cursor: p.cursor ?? undefined }), limit: 20 } }),
  payment: (id: string) => adminRequest<PaymentDetail>(`/admin/payments/${id}`),
  refund: (id: string, reason: string, amountPaise?: number) => adminRequest<RefundRow>(`/admin/payments/${id}/refund`, { method: "POST", body: amountPaise === undefined ? { reason } : { amountPaise, reason } }),
  recheck: (id: string) => adminRequest<{ state: "ACTIVE" | "PENDING" | "FAILED" }>(`/admin/payments/${id}/recheck`, { method: "POST" }),
  reconcile: () => adminRequest<{ checked: number; activated: number; errors: number }>("/admin/payments/reconcile", { method: "POST" }),
  webhooks: (p: WebhookQuery = {}) => adminRequest<Page<WebhookRow>>("/admin/webhook-events", { query: { ...q({ status: p.status, eventType: p.eventType, cursor: p.cursor ?? undefined }), limit: 25 } }),
  retryWebhooks: () => adminRequest<{ retried: number; recovered: number }>("/admin/webhook-events/retry", { method: "POST" }),
};
export { API_BASE };
