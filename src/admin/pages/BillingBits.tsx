import { useEffect, useState, type ReactNode } from "react";
import { Button, useToast } from "../../shared";
import { billingApi, personLabel, type Plan, type UserBrief } from "../../api/admin-billing";
import { errorMessage } from "../hooks";
import { Modal, Pill } from "../ui";
import "./Billing.css";

export const dateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export const statusTone = (s: string): "green" | "amber" | "grey" | "red" | "violet" | "blue" =>
  ({ ACTIVE: "green", CAPTURED: "green", PROCESSED: "green", SUSPENDED: "red", FAILED: "red", CANCELLED: "red", DELETED: "grey", EXPIRED: "grey", IGNORED: "grey", CREATED: "amber", PENDING: "amber", RECEIVED: "amber", REFUNDED: "violet", PARTIALLY_REFUNDED: "violet" } as Record<string, "green" | "amber" | "grey" | "red" | "violet" | "blue">)[s] ?? "grey";
export const StatusPill = ({ status }: { status: string }) => <Pill tone={statusTone(status)}>{status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Pill>;

/** Name over email/phone, for list rows that used to show a bare user id. */
export function PersonCell({ user, userId }: { user: UserBrief | null | undefined; userId: string }) {
  const w = personLabel(user, userId);
  return <span className="a-cell"><span><b>{w.name}</b><small>{w.contact || `#${userId}`}</small></span></span>;
}

export function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <div className="a-error bl-loaderr" role="alert"><span>{error}</span><Button className="outline" onClick={onRetry}>Retry</Button></div>;
}
export const Loading = ({ label = "Loading..." }: { label?: string }) => <p className="a-muted bl-loading" role="status">{label}</p>;

export function Reason({ value, onChange, min = 3, max = 255, label = "Reason" }: { value: string; onChange: (v: string) => void; min?: number; max?: number; label?: string }) {
  return <label className="a-field"><span>{label}</span><textarea className="bl-textarea" rows={3} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`At least ${min} characters`} /></label>;
}

export function Row({ children }: { children: ReactNode }) { return <div className="bl-row">{children}</div>; }

/** Grant a subscription to a user (subscriptions.manage). `userId` fixed, or typed in when null. */
export function GrantModal({ userId: fixedUserId, onClose, onDone, canListAll }: { userId: string | null; onClose: () => void; onDone: () => void; canListAll: boolean }) {
  const notify = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [planErr, setPlanErr] = useState("");
  const [userId, setUserId] = useState(fixedUserId ?? "");
  const [planCode, setPlanCode] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    (canListAll ? billingApi.plans() : billingApi.publicPlans()).then((p) => { setPlans(p); setPlanCode((c) => c || p.find((x) => x.active)?.code || ""); }, (e) => setPlanErr(errorMessage(e, "Couldn't load plans.")));
  }, [canListAll]);
  const valid = /^\d+$/.test(userId.trim()) && planCode && reason.trim().length >= 3;
  const submit = async () => {
    setBusy(true); setErr("");
    try { await billingApi.grant(userId.trim(), planCode, reason.trim()); notify("Subscription granted"); onDone(); onClose(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Modal title="Grant subscription" onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="primary" disabled={!valid || busy} onClick={submit}>{busy ? "Granting..." : "Grant"}</Button></>}>
    <div className="a-form one">
      {fixedUserId === null && <label className="a-field"><span>User ID</span><input inputMode="numeric" value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 12 (see the Users page)" /></label>}
      <label className="a-field"><span>Plan</span>
        <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} disabled={!plans}>
          {!plans && <option>Loading plans...</option>}
          {plans?.map((p) => <option key={p.id} value={p.code}>{p.name} ({p.durationMonths} mo){p.active ? "" : " - inactive"}</option>)}
        </select>
      </label>
      {planErr && <div className="a-error">{planErr}</div>}
      <Reason value={reason} onChange={setReason} />
      <p className="a-muted bl-hint">The new period starts when the user's current access ends; it never overlaps.</p>
      {err && <div className="a-error" role="alert">{err}</div>}
    </div>
  </Modal>;
}
