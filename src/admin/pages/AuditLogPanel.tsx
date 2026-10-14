import { useEffect, useState } from "react";
import { Button } from "../../shared";
import { teamApi, type AuditRow } from "../../api/admin-team";
import { errorMessage } from "../hooks";
import { Empty, Field, Panel, Pill } from "../ui";

const safe = (v: unknown) => { try { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 300 ? `${s.slice(0, 300)}...` : s; } catch { return ""; } };

export default function AuditLogPanel({ names }: { names: Record<string, string> }) {
  const [action, setAction] = useState(""); const [entityType, setEntityType] = useState(""); const [actorType, setActorType] = useState("");
  const [actorId, setActorId] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ action: "", entityType: "", actorType: "", actorId: "", from: "", to: "" });
  const [formError, setFormError] = useState("");
  const [items, setItems] = useState<AuditRow[]>([]); const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [open, setOpen] = useState<string | null>(null);

  const load = async (cursor: string | null, replace: boolean) => {
    setLoading(true); setError("");
    try {
      const r = await teamApi.audit({ action: applied.action.trim() || undefined, entityType: applied.entityType.trim() || undefined, actorType: applied.actorType || undefined, actorId: applied.actorId.trim() || undefined, from: applied.from || undefined, to: applied.to || undefined, cursor, limit: 25 });
      setItems((p) => (replace ? r.items : [...p, ...r.items])); setNext(r.nextCursor);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(null, true); }, [applied]); // eslint-disable-line react-hooks/exhaustive-deps
  const who = (r: AuditRow) => r.actorType === "SYSTEM" ? "System" : r.actorType === "ADMIN" ? (r.actorId && names[r.actorId]) || `Admin #${r.actorId ?? "?"}` : `User #${r.actorId ?? "?"}`;

  return <Panel flush eyebrow="ACCOUNTABILITY" title="Audit log">
    <form className="a-form team-filters" onSubmit={(e) => { e.preventDefault(); 
      if (actorId.trim() && !/^\d{1,20}$/.test(actorId.trim())) return setFormError("Actor id must be a number.");
      if (from && to && from > to) return setFormError("The start date must not be after the end date.");
      setFormError(""); setApplied({ action, entityType, actorType, actorId, from, to }); }}>
      <Field label="Action starts with"><input value={action} placeholder="campaign." onChange={(e) => setAction(e.target.value)} /></Field>
      <Field label="Entity type"><input value={entityType} placeholder="admin_user" onChange={(e) => setEntityType(e.target.value)} /></Field>
      <Field label="Actor"><select value={actorType} onChange={(e) => setActorType(e.target.value)}><option value="">Anyone</option><option value="ADMIN">Admins</option><option value="USER">Viewers</option><option value="SYSTEM">System</option></select></Field>
      <Field label="Actor id" hint="Numeric id of the admin or viewer"><input inputMode="numeric" value={actorId} placeholder="12" onChange={(e) => setActorId(e.target.value)} /></Field>
      <Field label="From"><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
      <div className="team-filter-go"><Button className="primary" type="submit">Apply</Button></div>
    </form>
    {formError && <div className="a-pad"><div className="a-error" role="alert">{formError}</div></div>}
    {error ? <div className="a-pad"><div className="a-error">{error} <Button className="outline" onClick={() => load(null, true)}>Retry</Button></div></div>
      : !items.length ? <Empty icon="search" title={loading ? "Loading..." : "No matching entries"} />
      : <ul className="a-list">{items.map((r) => <li key={r.id}>
        <span className="grow"><b>{r.action}</b><small>{who(r)} · {new Date(r.createdAt).toLocaleString()}{r.entityType ? ` · ${r.entityType}${r.entityId ? ` #${r.entityId}` : ""}` : ""}{r.ipAddress ? ` · ${r.ipAddress}` : ""}</small>
          {open === r.id && <pre className="a-mono team-meta">{r.metadata ? safe(r.metadata) : "No details"}</pre>}</span>
        <Pill tone={r.actorType === "ADMIN" ? "violet" : "grey"}>{r.actorType}</Pill>
        <Button className="outline" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Hide" : "Details"}</Button>
      </li>)}</ul>}
    {next && !error && <div className="a-pad"><Button className="outline" disabled={loading} onClick={() => load(next, false)}>{loading ? "Loading..." : "Load more"}</Button></div>}
    <p className="a-muted a-pad">Filter by action prefix, entity type, actor type, actor id and a date range (UTC, both days included). Newest first.</p>
  </Panel>;
}
