import { viewerApi } from "./http";

/* Account-level calls for the signed-in viewer: payment history, data export, account deletion. */

export type PaymentStatus = "CREATED" | "CAPTURED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
/** One row of GET /payments/me. Amounts are integer paise; `*Display` strings are server-formatted rupees. */
export type PaymentItem = {
  id: string; planCode: string; durationMonths: number; amountPaise: number; amountDisplay: string; currency: string; status: PaymentStatus;
  method: string | null; failureReason: string | null; createdAt: string; capturedAt: string | null; refundedPaise: number;
  /** Unused value of the replaced plan that was deducted from the list price (0 for normal purchases). */
  creditPaise: number; upgrade: boolean;
};
export type AccountMe = { id: string; displayName: string; email: string | null; phone: string | null; hasPassword?: boolean };
export type DeleteAccountInput = { confirm: "DELETE"; password?: string; acknowledgeLostAccess?: boolean };

export const accountApi = {
  payments: () => viewerApi.request<PaymentItem[]>("/payments/me"),
  me: () => viewerApi.request<AccountMe>("/me"),
  /** Everything we hold about the viewer, as one JSON document. */
  exportData: () => viewerApi.request<Record<string, unknown>>("/me/export"),
  deleteAccount: (b: DeleteAccountInput) => viewerApi.request<void>("/me", { method: "DELETE", body: b }),
};

/** Rupee text from paise without float math ("14900" -> "₹149.00"). */
export const rupees = (paise: number) => `₹${Math.floor(paise / 100).toLocaleString("en-IN")}.${String(Math.round(paise) % 100).padStart(2, "0")}`;
