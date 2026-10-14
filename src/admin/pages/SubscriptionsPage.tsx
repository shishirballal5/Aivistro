import { useCallback, useEffect, useRef, useState } from "react";
import { Button, useToast } from "../../shared";
import { billingApi, personLabel, type SubscriptionRow } from "../../api/admin-billing";
import { useAdminSession } from "../session";
import { errorMessage } from "../hooks";
import { Avatar, Confirm, Empty, Modal, PageHead, Panel, SearchBox, fmtDate, type ConfirmState } from "../ui";
import { GrantModal, LoadError, Loading, Reason, StatusPill } from "./BillingBits";
import PaymentsTab from "./PaymentsTab";
import PlansTab from "./PlansTab";
import WebhooksTab from "./PaymentsWebhooksTab";
import "./Billing.css";

type Tab = "subs" | "payments" | "plans" | "webhooks";

export default function SubscriptionsPage() {
  const { can } = useAdminSession();
  const tabs = ([
    ["subs", "Subscriptions", can("subscriptions.read")], ["payments", "Payments", can("payments.read")],
    ["plans", "Plans", can("plans.manage")], ["webhooks", "Webhooks", can("payments.read")],
  ] as [Tab, string, boolean][]).filter((t) => t[2]);
  const [tab, setTab] = useState<Tab | null>(null);
  const cur = tab && tabs.some((t) => t[0] === tab) ? tab : tabs[0]?.[0];
  return <div className="a-page">
    <PageHead eyebrow="REVENUE" title="Subscriptions" sub="Subscriptions, payments, plans and gateway events." />
    {!cur ? <Panel><Empty icon="lock" title="No access" text="You don't have permission to view subscriptions or payments." /></Panel> : <>
      <div className="a-tabs bl-tabs" role="tablist">{tabs.map(([k, l]) => <button type="button" role="tab" aria-selected={cur === k} key={k} className={cur === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {cur === "subs" && <SubsTab canManage={can("subscriptions.manage")} canPlans={can("plans.manage")} />}
      {cur === "payments" && <PaymentsTab canRefund={can("payments.refund")} />}
      {cur === "plans" && <PlansTab />}
      {cur === "webhooks" && <WebhooksTab canRetry={can("payments.refund")} />}
    </>}
  </div>;
}

function SubsTab({ canManage, canPlans }: { canManage: boolean; canPlans: boolean }) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const [grant, setGrant] = useState(false);
  const [revoking, setRevoking] = useState<SubscriptionRow | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const load = useCallback(async (cursor: string | null) => {
    const id = ++seq.current;
    setLoading(true); setError("");
    try {
      const r = await billingApi.subscriptions({ q: dq || undefined, status: status || undefined, planCode: planCode.trim() || undefined, cursor });
      if (id !== seq.current) return;
      setRows((p) => (cursor ? [...p, ...r.items] : r.items)); setNext(r.nextCursor);
    } catch (e) { if (id === seq.current) setError(errorMessage(e, "Couldn't load subscriptions.")); }
    finally { if (id === seq.current) setLoading(false); }
  }, [dq, status, planCode]);
  useEffect(() => { load(null); }, [load]);
  const filtered = !!(dq || status || planCode);
  return <Panel flush eyebrow="ACCESS" title="Subscriptions" action={canManage ? <Button className="primary" icon="plus" onClick={() => setGrant(true)}>Grant subscription</Button> : undefined}>
    <div className="a-toolbar">
      <SearchBox value={q} onChange={setQ} placeholder="Search by name, email or phone..." />
      <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">Status: All</option>{["ACTIVE", "EXPIRED", "CANCELLED", "REFUNDED"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
      </select>
      <input aria-label="Plan code" className="bl-plan-filter" placeholder="Plan code" value={planCode} maxLength={30} onChange={(e) => setPlanCode(e.target.value)} />
    </div>
    {error ? <LoadError error={error} onRetry={() => load(null)} /> : loading && !rows.length ? <Loading label="Loading subscriptions..." /> : rows.length ? <>
      <div className="a-table-wrap"><table className="a-table"><thead><tr><th>User</th><th>Plan</th><th>Status</th><th>Start</th><th>End</th><th>Source</th><th /></tr></thead><tbody>
        {rows.map((s) => { const who = personLabel(s.user, s.userId); return <tr key={s.id}><td><span className="a-cell"><Avatar name={who.name} /><span><b>{who.name}</b><small>{who.contact || `#${s.userId}`}</small></span></span></td><td>{s.planName ?? "—"}</td><td><StatusPill status={s.status} /></td><td>{fmtDate(s.startsAt)}</td><td>{fmtDate(s.endsAt)}</td>
          <td>{s.source === "ADMIN_GRANT" ? "Admin grant" : "Purchase"}{s.grantReason && <small className="a-sub">{s.grantReason}</small>}</td>
          <td>{canManage && s.status === "ACTIVE" ? <Button className="outline" onClick={() => setRevoking(s)}>Revoke</Button> : null}</td></tr>; })}
      </tbody></table></div>
      {next && <div className="bl-more"><Button className="outline" disabled={loading} onClick={() => load(next)}>{loading ? "Loading..." : "Load more"}</Button></div>}
    </> : loading ? <Loading /> : <Empty icon="star" title={filtered ? "No matching subscriptions" : "No subscriptions yet"} text={filtered ? "Try a different search or filter." : "Purchased and granted subscriptions appear here."} />}
    {grant && <GrantModal userId={null} canListAll={canPlans} onClose={() => setGrant(false)} onDone={() => load(null)} />}
    {revoking && <RevokeModal sub={revoking} onClose={() => setRevoking(null)} onDone={() => load(null)} />}
  </Panel>;
}

function RevokeModal({ sub, onClose, onDone }: { sub: SubscriptionRow; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const run = async () => {
    setBusy(true); setErr("");
    try { await billingApi.revoke(sub.id, reason.trim()); notify("Subscription revoked"); onDone(); onClose(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const valid = reason.trim().length >= 3;
  return <Modal title="Revoke subscription" onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="a-danger" disabled={!valid || busy} onClick={() => setConfirm({ title: "Revoke this subscription?", text: `${personLabel(sub.user, sub.userId).name} loses access immediately. This does not refund any payment.`, label: "Revoke", danger: true, onConfirm: run })}>{busy ? "Revoking..." : "Revoke"}</Button></>}>
    <div className="a-form one">
      <p className="a-muted">{sub.planName ?? "Subscription"} for {personLabel(sub.user, sub.userId).name}, {fmtDate(sub.startsAt)} to {fmtDate(sub.endsAt)}.</p>
      <Reason value={reason} onChange={setReason} max={60} />
      {err && <div className="a-error" role="alert">{err}</div>}
    </div>
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </Modal>;
}
