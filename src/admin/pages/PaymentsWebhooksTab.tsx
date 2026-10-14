import { useCallback, useEffect, useRef, useState } from "react";
import { Button, useToast } from "../../shared";
import { billingApi, type WebhookRow } from "../../api/admin-billing";
import { errorMessage } from "../hooks";
import { Confirm, Empty, Panel, type ConfirmState } from "../ui";
import { LoadError, Loading, StatusPill, dateTime } from "./BillingBits";
import "./Billing.css";

export default function WebhooksTab({ canRetry }: { canRetry: boolean }) {
  const notify = useToast();
  const [status, setStatus] = useState("");
  const [eventType, setEventType] = useState("");
  const [deb, setDeb] = useState("");
  const [rows, setRows] = useState<WebhookRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const seq = useRef(0);
  useEffect(() => { const t = setTimeout(() => setDeb(eventType.trim()), 300); return () => clearTimeout(t); }, [eventType]);
  const load = useCallback(async (cursor: string | null) => {
    const id = ++seq.current;
    setLoading(true); setError("");
    try {
      const r = await billingApi.webhooks({ status: status || undefined, eventType: deb || undefined, cursor });
      if (id !== seq.current) return;
      setRows((p) => (cursor ? [...p, ...r.items] : r.items)); setNext(r.nextCursor);
    } catch (e) { if (id === seq.current) setError(errorMessage(e, "Couldn't load events.")); }
    finally { if (id === seq.current) setLoading(false); }
  }, [status, deb]);
  useEffect(() => { load(null); }, [load]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const retry = async () => {
    setBusy(true);
    try { const r = await billingApi.retryWebhooks(); notify(`Retried ${r.retried}, recovered ${r.recovered}`); load(null); } catch (e) { notify(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Panel flush eyebrow="GATEWAY" title="Webhook events" action={canRetry ? <Button className="outline" disabled={busy} onClick={() => setConfirm({ title: "Retry failed events?", text: "Re-processes failed webhook events that still have retries left. Amount mismatches are skipped (they need a human).", label: "Retry failed", onConfirm: retry })}>{busy ? "Retrying..." : "Retry failed"}</Button> : undefined}>
    <div className="a-toolbar">
      <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Status: All</option>{["RECEIVED", "PROCESSED", "IGNORED", "FAILED"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
      <input aria-label="Event type" className="bl-plan-filter" placeholder="Event type, e.g. payment.failed" value={eventType} maxLength={60} onChange={(e) => setEventType(e.target.value)} />
    </div>
    {error ? <LoadError error={error} onRetry={() => load(null)} /> : loading && !rows.length ? <Loading label="Loading events..." /> : rows.length ? <>
      <div className="a-table-wrap"><table className="a-table"><thead><tr><th>Event</th><th>Provider event id</th><th>Status</th><th>Attempts</th><th>Note / error</th><th>Received</th></tr></thead><tbody>
        {rows.map((w) => <tr key={w.id}><td>{w.eventType}</td><td className="a-mono bl-wrap">{w.providerEventId ?? "—"}</td><td><StatusPill status={w.status} /></td><td>{w.attempts}</td><td>{w.note ?? "—"}</td><td>{dateTime(w.createdAt)}</td></tr>)}
      </tbody></table></div>
      {next && <div className="bl-more"><Button className="outline" disabled={loading} onClick={() => load(next)}>{loading ? "Loading..." : "Load more"}</Button></div>}
    </> : loading ? <Loading /> : <Empty icon="card" title="No webhook events" text={status || deb ? "None match these filters." : "The gateway has not sent any events yet."} />}
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </Panel>;
}
