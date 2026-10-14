import { useState } from "react";
import { Button, useToast } from "../../shared";
import { billingApi, paiseToRupeeText, rupeesToPaise, type Plan } from "../../api/admin-billing";
import { errorMessage, useAsync } from "../hooks";
import { Empty, Field, Modal, Panel, Pill, Toggle } from "../ui";
import { LoadError, Loading } from "./BillingBits";
import "./Billing.css";

export default function PlansTab() {
  const plans = useAsync<Plan[]>(() => billingApi.plans(), []);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  return <Panel eyebrow="PRICING" title="Plans" action={<Button icon="plus" className="primary" onClick={() => setEditing("new")}>New plan</Button>}>
    <div className="a-note" style={{ marginBottom: 16 }}>Changing a price only affects NEW purchases. Existing payments and subscriptions keep the price and duration they were bought at. Plan code and duration cannot be changed after creation.</div>
    {plans.error ? <LoadError error={plans.error} onRetry={plans.reload} /> : plans.loading && !plans.data ? <Loading label="Loading plans..." /> : plans.data?.length ? <div className="a-plans">
      {plans.data.map((p) => <div key={p.id} className={`a-plan ${p.active ? "" : "off"}`}>
        <div><b>{p.name} <Pill tone={p.active ? "green" : "grey"}>{p.active ? "On sale" : "Inactive"}</Pill></b><small>{p.code} · {p.durationMonths} {p.durationMonths === 1 ? "month" : "months"} · order {p.sortOrder}</small></div>
        <div style={{ font: "26px var(--serif)" }}>{p.priceDisplay}</div>
        {p.description && <small>{p.description}</small>}
        <div className="a-plan-foot"><Button className="outline" onClick={() => setEditing(p)}>Edit</Button></div>
      </div>)}
    </div> : plans.loading ? <Loading /> : <Empty icon="card" title="No plans yet" text="Create the first plan to start selling subscriptions." />}
    {editing && <PlanModal plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={plans.reload} />}
  </Panel>;
}

function PlanModal({ plan, onClose, onDone }: { plan: Plan | null; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const [code, setCode] = useState(plan?.code ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [months, setMonths] = useState(String(plan?.durationMonths ?? 1));
  const [price, setPrice] = useState(plan ? paiseToRupeeText(plan.pricePaise) : "");
  const [active, setActive] = useState(plan?.active ?? true);
  const [sort, setSort] = useState(String(plan?.sortOrder ?? 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const paise = rupeesToPaise(price);
  const m = /^\d+$/.test(months) ? Number(months) : NaN;
  const s = /^\d+$/.test(sort) ? Number(sort) : NaN;
  const problems: string[] = [];
  if (!plan && !/^[a-z][a-z0-9_-]{1,29}$/.test(code)) problems.push("Code: 2-30 chars, lowercase letters, digits, - or _, starting with a letter.");
  if (!name.trim() || name.length > 80) problems.push("Name is required (max 80).");
  if (description.length > 255) problems.push("Description max 255 characters.");
  if (!plan && !(m >= 1 && m <= 36)) problems.push("Duration must be 1-36 months.");
  if (paise === null) problems.push("Price must be a rupee amount with at most 2 decimals.");
  else if (paise < 100 || paise > 10_000_000) problems.push("Price must be between ₹1 and ₹100,000.");
  if (!(s >= 0 && s <= 1000)) problems.push("Sort order must be 0-1000.");

  const save = async () => {
    setBusy(true); setErr("");
    try {
      if (plan) await billingApi.updatePlan(plan.id, { name: name.trim(), description, pricePaise: paise!, active, sortOrder: s });
      else await billingApi.createPlan({ code, name: name.trim(), description: description || undefined, durationMonths: m, pricePaise: paise!, sortOrder: s });
      notify(plan ? "Plan updated" : "Plan created"); onDone(); onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Modal title={plan ? `Edit ${plan.name}` : "New plan"} onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy || problems.length > 0} onClick={save}>{busy ? "Saving..." : "Save plan"}</Button></>}>
    <div className="bl-plan-form">
      <Field label="Code" hint={plan ? "Cannot be changed" : "Lowercase, e.g. monthly"}><input value={code} disabled={!!plan} onChange={(e) => setCode(e.target.value)} /></Field>
      <Field label="Name"><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Description" full><input value={description} maxLength={255} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Duration (months)" hint={plan ? "Cannot be changed" : "1-36"}><input inputMode="numeric" value={months} disabled={!!plan} onChange={(e) => setMonths(e.target.value)} /></Field>
      <Field label="Price (₹)" hint="Applies to new purchases only"><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="149.00" /></Field>
      <Field label="Sort order"><input inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} /></Field>
      {plan && <div className="a-field"><span>Active (on sale)</span><Toggle on={active} onChange={setActive} label="Plan active" /></div>}
      {!!problems.length && <div className="a-error full" role="alert">{problems.join(" ")}</div>}
      {err && <div className="a-error full" role="alert">{err}</div>}
    </div>
  </Modal>;
}
