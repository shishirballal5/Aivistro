import { useCallback, useEffect, useRef, useState } from "react";
import { Button, useToast } from "../../shared";
import { billingApi, type PaymentRow, type SubscriptionRow, type UserDetail, type UserRow } from "../../api/admin-billing";
import { useAdminSession } from "../session";
import { errorMessage, useAsync } from "../hooks";
import { Avatar, Confirm, Empty, Modal, PageHead, Panel, SearchBox, fmtDate, type ConfirmState } from "../ui";
import { GrantModal, LoadError, Loading, StatusPill, dateTime } from "./BillingBits";
import "./Billing.css";

const contact = (u: { email: string | null; phone: string | null }) => [u.email, u.phone].filter(Boolean).join(" · ") || "No email or phone";
const nameOf = (u: UserRow) => u.displayName || u.email || u.phone || `User #${u.id}`;

export default function UsersPage() {
  const { can } = useAdminSession();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<UserRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async (cursor: string | null) => {
    const id = ++seq.current;
    setLoading(true); setError("");
    try {
      const r = await billingApi.users({ q: dq || undefined, status: status || undefined, cursor });
      if (id !== seq.current) return;
      setRows((prev) => (cursor ? [...prev, ...r.items] : r.items));
      setNext(r.nextCursor);
    } catch (e) { if (id === seq.current) setError(errorMessage(e, "Couldn't load users.")); }
    finally { if (id === seq.current) setLoading(false); }
  }, [dq, status]);
  useEffect(() => { load(null); }, [load]);

  const patchRow = (id: string, s: UserRow["status"]) => setRows((r) => r.map((u) => (u.id === id ? { ...u, status: s } : u)));

  return <div className="a-page">
    <PageHead eyebrow="AUDIENCE" title="Users" sub="Search viewer accounts, review their subscription state and manage access." />
    <Panel flush>
      <div className="a-toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search by email or phone..." />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Status: All</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="DELETED">Deleted</option>
        </select>
      </div>
      {error ? <LoadError error={error} onRetry={() => load(null)} /> : loading && !rows.length ? <Loading label="Loading users..." /> : rows.length ? <>
        <div className="a-table-wrap"><table className="a-table"><thead><tr><th>User</th><th>Status</th><th>Joined</th><th>Last sign-in</th><th /></tr></thead><tbody>
          {rows.map((u) => <tr key={u.id} className="clickable" onClick={() => setViewing(u.id)}>
            <td><span className="a-cell"><Avatar name={nameOf(u)} /><span><b>{nameOf(u)}</b><small>{contact(u)}</small></span></span></td>
            <td><StatusPill status={u.status} />{u.status === "SUSPENDED" && u.suspendedReason && <small className="a-sub" title={u.suspendedReason}>{u.suspendedReason}</small>}</td><td>{fmtDate(u.createdAt)}</td><td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : "Never"}</td>
            <td><Button className="outline" onClick={() => setViewing(u.id)}>View</Button></td></tr>)}
        </tbody></table></div>
        {next && <div className="bl-more"><Button className="outline" disabled={loading} onClick={() => load(next)}>{loading ? "Loading..." : "Load more"}</Button></div>}
      </> : loading ? <Loading label="Loading users..." /> : <Empty title="No users found" text={dq || status ? "Try a different search or filter." : "No viewers have signed up yet."} />}
    </Panel>
    {viewing && <UserDrawer id={viewing} can={can} onClose={() => setViewing(null)} onStatus={patchRow} />}
  </div>;
}

function UserDrawer({ id, can, onClose, onStatus }: { id: string; can: (p: string) => boolean; onClose: () => void; onStatus: (id: string, s: UserRow["status"]) => void }) {
  const notify = useToast();
  const user = useAsync<UserDetail>(() => billingApi.user(id), [id]);
  const subs = useAsync<SubscriptionRow[]>(() => (can("subscriptions.read") ? billingApi.subscriptions({ userId: id }).then((r) => r.items) : Promise.resolve([])), [id]);
  const pays = useAsync<PaymentRow[]>(() => (can("payments.read") ? billingApi.payments({ userId: id }).then((r) => r.items) : Promise.resolve([])), [id]);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [suspending, setSuspending] = useState(false);
  const [grant, setGrant] = useState(false);
  const [busy, setBusy] = useState(false);
  const u = user.data;

  const restore = async () => {
    setBusy(true);
    try { await billingApi.restore(id); notify("Account restored"); onStatus(id, "ACTIVE"); user.reload(); } catch (e) { notify(errorMessage(e)); } finally { setBusy(false); }
  };

  return <Modal wide title="User profile" onClose={onClose} footer={<Button className="outline" onClick={onClose}>Close</Button>}>
    {user.error ? <LoadError error={user.error} onRetry={user.reload} /> : !u ? <Loading label="Loading profile..." /> : <>
      <div className="a-profile"><Avatar name={u.displayName || u.email || u.phone || "U"} size={56} /><div><h3 className="heading">{u.displayName || "Unnamed viewer"}</h3><p className="a-muted">{contact(u)}</p></div></div>
      <dl className="a-dl">
        <div><dt>User ID</dt><dd>{u.id}</dd></div><div><dt>Status</dt><dd><StatusPill status={u.status} /></dd></div>
        {u.status === "SUSPENDED" && <div><dt>Suspended</dt><dd>{u.suspendedAt ? dateTime(u.suspendedAt) : "—"}</dd></div>}
        {u.status === "SUSPENDED" && <div><dt>Reason</dt><dd>{u.suspendedReason || "No reason given"}</dd></div>}
        {u.status === "DELETED" && <div><dt>Deleted by user</dt><dd>{u.deletedAt ? dateTime(u.deletedAt) : "—"}</dd></div>}
        <div><dt>Email</dt><dd>{u.email ? `${u.email} (${u.emailVerified ? "verified" : "unverified"})` : "—"}</dd></div>
        <div><dt>Phone</dt><dd>{u.phone ? `${u.phone} (${u.phoneVerified ? "verified" : "unverified"})` : "—"}</dd></div>
        <div><dt>Joined</dt><dd>{dateTime(u.createdAt)}</dd></div><div><dt>Last sign-in</dt><dd>{u.lastLoginAt ? dateTime(u.lastLoginAt) : "Never"}</dd></div>
      </dl>
      <div className="bl-row bl-section">
        {can("users.manage") && u.status === "ACTIVE" && <Button className="a-danger" disabled={busy} onClick={() => setSuspending(true)}>Suspend account</Button>}
        {can("users.manage") && u.status === "SUSPENDED" && <Button className="primary" disabled={busy} onClick={() => setConfirm({ title: "Restore this account?", text: "The user will be able to sign in and watch again.", label: "Restore", onConfirm: restore })}>Restore account</Button>}
        {can("subscriptions.manage") && u.status !== "DELETED" && <Button className="outline" onClick={() => setGrant(true)}>Grant subscription</Button>}
      </div>
      {can("subscriptions.read") && <div className="bl-section"><h3>Subscriptions</h3>
        {subs.error ? <LoadError error={subs.error} onRetry={subs.reload} /> : subs.loading ? <Loading /> : subs.data?.length ? <div className="a-table-wrap"><table className="bl-mini"><thead><tr><th>Plan</th><th>Status</th><th>Period</th><th>Source</th></tr></thead><tbody>
          {subs.data.map((s) => <tr key={s.id}><td>{s.planName ?? "—"}</td><td><StatusPill status={s.status} /></td><td>{fmtDate(s.startsAt)} to {fmtDate(s.endsAt)}</td><td>{s.source === "ADMIN_GRANT" ? "Admin grant" : "Purchase"}</td></tr>)}
        </tbody></table></div> : <p className="a-muted">No subscriptions.</p>}</div>}
      {can("payments.read") && <div className="bl-section"><h3>Recent payments</h3>
        {pays.error ? <LoadError error={pays.error} onRetry={pays.reload} /> : pays.loading ? <Loading /> : pays.data?.length ? <div className="a-table-wrap"><table className="bl-mini"><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead><tbody>
          {pays.data.map((p) => <tr key={p.id}><td>{dateTime(p.createdAt)}</td><td>{p.planCode}</td><td>{p.amountDisplay}</td><td><StatusPill status={p.status} /></td></tr>)}
        </tbody></table></div> : <p className="a-muted">No payments.</p>}</div>}
    </>}
    {suspending && u && <SuspendModal name={u.displayName || u.email || u.phone || `User #${u.id}`} id={id} onClose={() => setSuspending(false)} onDone={() => { onStatus(id, "SUSPENDED"); user.reload(); }} />}
    {grant && <GrantModal userId={id} canListAll={can("plans.manage")} onClose={() => setGrant(false)} onDone={subs.reload} />}
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </Modal>;
}

function SuspendModal({ name, id, onClose, onDone }: { name: string; id: string; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const run = async () => {
    setBusy(true); setErr("");
    try { await billingApi.suspend(id, reason.trim() || undefined); notify("Account suspended"); onDone(); onClose(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Modal title={`Suspend ${name}?`} onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="a-danger" disabled={busy} onClick={() => setConfirm({ title: "Suspend this account?", text: "They are signed out everywhere and any playing video stops immediately.", label: "Suspend", danger: true, onConfirm: run })}>{busy ? "Suspending..." : "Suspend"}</Button></>}>
    <div className="a-form one">
      <p className="a-muted">The user is signed out everywhere immediately and cannot sign in until restored.</p>
      <label className="a-field"><span>Reason (optional)</span><textarea className="bl-textarea" rows={3} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {err && <div className="a-error" role="alert">{err}</div>}
    </div>
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </Modal>;
}
