import { useCallback, useEffect, useState } from "react";
import { accountApi, rupees, type PaymentItem, type PaymentStatus } from "../api/viewer-account";
import { Button, formatDate } from "../shared";
import { errorText } from "./model";
import "./PaymentHistory.css";

const STATUS: Record<PaymentStatus, { label: string; tone: "ok" | "warn" | "bad" | "refund" }> = {
  CAPTURED: { label: "Paid", tone: "ok" }, CREATED: { label: "Pending", tone: "warn" }, FAILED: { label: "Failed", tone: "bad" },
  REFUNDED: { label: "Refunded", tone: "refund" }, PARTIALLY_REFUNDED: { label: "Partly refunded", tone: "refund" },
};
const planLabel = (p: PaymentItem) => `${p.planCode.charAt(0).toUpperCase()}${p.planCode.slice(1)} plan${p.durationMonths ? ` · ${p.durationMonths} ${p.durationMonths === 1 ? "month" : "months"}` : ""}`;

/** The signed-in viewer's payments, newest first. Meant to sit inside the Profile page. */
export default function PaymentHistory() {
  const [items, setItems] = useState<PaymentItem[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    accountApi.payments().then(setItems, (e) => setError(errorText(e, "Couldn't load your payments.")));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="state-card" role="alert"><div className="form-error">{error}</div><div className="state-actions"><Button className="outline" onClick={load}>Try again</Button></div></div>;
  if (!items) return <p className="payment-note" role="status">Loading your payments...</p>;
  if (!items.length) return <div className="state-card"><h3>No payments yet</h3><p>When you subscribe, your receipts and refunds will show up here.</p></div>;

  return <ul className="pay-history" aria-label="Payment history" style={{ listStyle: "none", padding: 0 }}>
    {items.map((p) => { const st = STATUS[p.status] ?? { label: p.status, tone: "warn" as const }; return <li key={p.id} className="pay-row">
      <span>
        <b>{planLabel(p)}</b>
        <small>{formatDate(new Date(p.capturedAt ?? p.createdAt))}{p.method ? ` · ${p.method}` : ""}</small>
        {p.upgrade && <small>Upgrade{p.creditPaise > 0 ? `: ${rupees(p.creditPaise)} credit for your unused time was deducted` : ""}</small>}
        {p.refundedPaise > 0 && <small>Refunded {rupees(p.refundedPaise)}</small>}
        {p.status === "FAILED" && p.failureReason && <small>{p.failureReason}</small>}
      </span>
      <span className="pay-meta"><span className={`pay-pill ${st.tone}`}>{st.label}</span><span className="pay-amount">{p.amountDisplay}</span></span>
    </li>; })}
  </ul>;
}
