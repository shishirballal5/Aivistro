import { useCallback, useEffect, useRef, useState } from "react";
import { Button, useToast } from "../../shared";
import { billingApi, formatPaise, paiseToRupeeText, rupeesToPaise, personLabel, type PaymentDetail, type PaymentRow } from "../../api/admin-billing";
import { errorMessage, useAsync } from "../hooks";
import { Confirm, Empty, Modal, Panel, type ConfirmState } from "../ui";
import { LoadError, Loading, PersonCell, Reason, StatusPill, dateTime } from "./BillingBits";
import "./Billing.css";

export default function PaymentsTab({ canRefund }: { canRefund: boolean }) {
  const notify = useToast();
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (cursor: string | null) => {
    const id = ++seq.current;
    setLoading(true); setError("");
    try {
      const r = await billingApi.payments({ status: status || undefined, cursor });
      if (id !== seq.current) return;
      setRows((p) => (cursor ? [...p, ...r.items] : r.items)); setNext(r.nextCursor);
    } catch (e) { if (id === seq.current) setError(errorMessage(e, "Couldn't load payments.")); }
    finally { if (id === seq.current) setLoading(false); }
  }, [status]);
  useEffect(() => { load(null); }, [load]);

  const reconcile = async () => {
    setBusy(true);
    try { const r = await billingApi.reconcile(); notify(`Reconciled: checked ${r.checked}, activated ${r.activated}, errors ${r.errors}`); load(null); }
    catch (e) { notify(errorMessage(e)); } finally { setBusy(false); }
  };

  return <Panel flush eyebrow="TRANSACTIONS" title="Payments" action={canRefund ? <Button className="outline" disabled={busy} onClick={() => setConfirm({ title: "Reconcile pending payments?", text: "Asks the gateway about every unpaid or failed payment from the last 7 days and activates any that were actually paid.", label: "Reconcile", onConfirm: reconcile })}>{busy ? "Reconciling..." : "Reconcile pending"}</Button> : undefined}>
    <div className="a-toolbar">
      <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Status: All</option>{["CREATED", "CAPTURED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"].map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
      </select>
    </div>
    {error ? <LoadError error={error} onRetry={() => load(null)} /> : loading && !rows.length ? <Loading label="Loading payments..." /> : rows.length ? <>
      <div className="a-table-wrap"><table className="a-table"><thead><tr><th>Payment</th><th>User</th><th>Plan</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th><th /></tr></thead><tbody>
        {rows.map((p) => <tr key={p.id} className="clickable" onClick={() => setOpen(p.id)}>
          <td className="a-mono">#{p.id}</td><td><PersonCell user={p.user} userId={p.userId} /></td><td>{p.planCode}</td><td>{p.amountDisplay}{p.refundedPaise > 0 && <small className="a-sub">refunded {formatPaise(p.refundedPaise)}</small>}</td><td>{p.method ?? "—"}</td><td><StatusPill status={p.status} /></td><td>{dateTime(p.createdAt)}</td>
          <td><Button className="outline" onClick={() => setOpen(p.id)}>Details</Button></td></tr>)}
      </tbody></table></div>
      {next && <div className="bl-more"><Button className="outline" disabled={loading} onClick={() => load(next)}>{loading ? "Loading..." : "Load more"}</Button></div>}
    </> : loading ? <Loading /> : <Empty icon="card" title="No payments found" text={status ? "No payments with this status." : "No payments yet."} />}
    {open && <PaymentModal id={open} canRefund={canRefund} onClose={() => setOpen(null)} onChanged={() => load(null)} />}
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </Panel>;
}

function PaymentModal({ id, canRefund, onClose, onChanged }: { id: string; canRefund: boolean; onClose: () => void; onChanged: () => void }) {
  const notify = useToast();
  const d = useAsync<PaymentDetail>(() => billingApi.payment(id), [id]);
  const [refunding, setRefunding] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [busy, setBusy] = useState(false);
  const p = d.data;
  const recheck = async () => {
    setBusy(true);
    try { const r = await billingApi.recheck(id); notify(`Gateway says: ${r.state}`); d.reload(); onChanged(); } catch (e) { notify(errorMessage(e)); } finally { setBusy(false); }
  };
  // Pending + processed refunds are reserved by the server; failed ones are not.
  const reserved = p ? p.refunds.filter((r) => r.status !== "FAILED").reduce((a, r) => a + r.amountPaise, 0) : 0;
  const refundable = p ? p.amountPaise - reserved : 0;
  const canRefundNow = !!p && canRefund && (p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED") && !!p.providerPaymentId && refundable > 0;
  const canRecheck = !!p && canRefund && (p.status === "CREATED" || p.status === "FAILED");
  return <Modal wide title={`Payment #${id}`} onClose={onClose} footer={<Button className="outline" onClick={onClose}>Close</Button>}>
    {d.error ? <LoadError error={d.error} onRetry={d.reload} /> : !p ? <Loading /> : <>
      <dl className="a-dl">
        <div><dt>Status</dt><dd><StatusPill status={p.status} /></dd></div><div><dt>Amount</dt><dd>{p.amountDisplay}</dd></div>
        <div><dt>Plan</dt><dd>{p.planCode} ({p.durationMonths} mo)</dd></div><div><dt>Method</dt><dd>{p.method ?? "—"}</dd></div>
        <div><dt>User</dt><dd>{(() => { const w = personLabel(p.user, p.userId); return <>{w.name}{w.contact && <small className="a-sub">{w.contact}</small>}</>; })()}</dd></div><div><dt>Upgrade credit</dt><dd>{(p.creditPaise ?? 0) > 0 ? formatPaise(p.creditPaise!) : "—"}</dd></div><div><dt>Refunded</dt><dd>{formatPaise(p.refundedPaise)}</dd></div>
        <div><dt>Created</dt><dd>{dateTime(p.createdAt)}</dd></div><div><dt>Captured</dt><dd>{dateTime(p.capturedAt)}</dd></div>
        <div><dt>Provider</dt><dd>{p.provider}</dd></div><div><dt>Subscription</dt><dd>{p.subscriptionId ? `#${p.subscriptionId}` : "—"}</dd></div>
        <div><dt>Gateway order id</dt><dd className="a-mono bl-wrap">{p.providerOrderId}</dd></div><div><dt>Gateway payment id</dt><dd className="a-mono bl-wrap">{p.providerPaymentId ?? "—"}</dd></div>
      </dl>
      {p.failureReason && <div className="a-error">Failure: {p.failureReason}</div>}
      <div className="bl-row bl-section">
        {canRefundNow && <Button className="a-danger" onClick={() => setRefunding(true)}>Refund...</Button>}
        {canRecheck && <Button className="outline" disabled={busy} onClick={() => setConfirm({ title: "Recheck with gateway?", text: "Asks the payment gateway for the current state and activates the subscription if it was actually paid.", label: "Recheck", onConfirm: recheck })}>{busy ? "Checking..." : "Recheck with gateway"}</Button>}
      </div>
      <div className="bl-section"><h3>Refunds</h3>
        {p.refunds.length ? <div className="a-table-wrap"><table className="bl-mini"><thead><tr><th>Amount</th><th>Status</th><th>Reason</th><th>Processed</th></tr></thead><tbody>
          {p.refunds.map((r) => <tr key={r.id}><td>{r.amountDisplay}</td><td><StatusPill status={r.status} />{r.failureReason && <div className="bl-note">{r.failureReason}</div>}</td><td>{r.reason}</td><td>{dateTime(r.processedAt)}</td></tr>)}
        </tbody></table></div> : <p className="a-muted">No refunds.</p>}</div>
      <div className="bl-section"><h3>Webhook events</h3>
        {p.webhookEvents.length ? <div className="a-table-wrap"><table className="bl-mini"><thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Note</th><th>Received</th></tr></thead><tbody>
          {p.webhookEvents.map((w) => <tr key={w.id}><td>{w.eventType}</td><td><StatusPill status={w.status} /></td><td>{w.attempts}</td><td>{w.note ?? "—"}</td><td>{dateTime(w.createdAt)}</td></tr>)}
        </tbody></table></div> : <p className="a-muted">No webhook events linked to this order.</p>}</div>
    </>}
    {refunding && p && <RefundModal p={p} refundable={refundable} onClose={() => setRefunding(false)} onDone={() => { d.reload(); onChanged(); }} />}
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </Modal>;
}

function RefundModal({ p, refundable, onClose, onDone }: { p: PaymentDetail; refundable: number; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const [full, setFull] = useState(true);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const paise = full ? refundable : rupeesToPaise(amount);
  const amountErr = full ? "" : !amount.trim() ? "" : paise === null ? "Enter a rupee amount with at most 2 decimals." : paise < 1 ? "Amount must be greater than zero." : paise > refundable ? `Cannot exceed the refundable ${formatPaise(refundable)}.` : "";
  const valid = paise !== null && paise >= 1 && paise <= refundable && reason.trim().length >= 3;
  const run = async () => {
    setBusy(true); setErr("");
    try { await billingApi.refund(p.id, reason.trim(), full ? undefined : paise!); notify("Refund issued"); onDone(); onClose(); }
    catch (e) { setErr(errorMessage(e)); onDone(); } finally { setBusy(false); }
  };
  return <Modal title="Refund payment" onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="a-danger" disabled={!valid || busy} onClick={() => setConfirm({ title: "Issue this refund?", text: `${formatPaise(paise ?? 0)} will be refunded to the customer via the gateway. This cannot be undone.`, label: "Refund", danger: true, onConfirm: run })}>{busy ? "Refunding..." : "Refund"}</Button></>}>
    <div className="a-form one">
      <p className="a-muted">Paid {p.amountDisplay}. Refundable now: <b>{formatPaise(refundable)}</b> ({paiseToRupeeText(refundable)} INR).</p>
      <div className="bl-row"><label><input type="radio" checked={full} onChange={() => setFull(true)} /> Full ({formatPaise(refundable)})</label><label><input type="radio" checked={!full} onChange={() => setFull(false)} /> Partial</label></div>
      {!full && <label className="a-field"><span>Amount (₹)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 49.50" />{amountErr && <small style={{ color: "#ff9e98" }}>{amountErr}</small>}</label>}
      <Reason value={reason} onChange={setReason} />
      {err && <div className="a-error" role="alert">{err}</div>}
    </div>
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </Modal>;
}
