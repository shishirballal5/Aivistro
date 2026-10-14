import { useState } from "react";
import { Button, Icon, useToast } from "../../shared";
import { SECTION_TYPES, sectionsApi, type AdminSection, type SectionType } from "../../api/admin-insights";
import { errorMessage, useAsync } from "../hooks";
import { Confirm, Empty, Field, Modal, Panel, Pill, RowMenu, Toggle, type ConfirmState } from "../ui";
import { SeriesSearch } from "./HomepageSeriesPicker";
import "./BannersPage.css";

export default function HomepageSections({ canWrite, titles }: { canWrite: boolean; titles: Map<string, string> }) {
  const notify = useToast();
  const { data, error, loading, reload } = useAsync(() => sectionsApi.list(), []);
  const [editing, setEditing] = useState<AdminSection | "new" | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const toggle = async (s: AdminSection, active: boolean) => {
    try { await sectionsApi.update(s.id, { key: s.key, title: s.title, type: s.type, sortOrder: s.sortOrder, active, seriesIds: s.seriesIds }); notify(active ? "Section shown" : "Section hidden"); reload(); } catch (e) { notify(errorMessage(e)); }
  };
  const remove = (s: AdminSection) => setConfirm({ title: "Delete section?", text: `"${s.title}" will be removed from the home page.`, label: "Delete", danger: true, onConfirm: async () => { try { await sectionsApi.remove(s.id); notify("Section deleted"); reload(); } catch (e) { notify(errorMessage(e)); } } });

  return <Panel flush eyebrow="HOME PAGE" title="Sections" action={canWrite ? <Button className="primary" icon="plus" onClick={() => setEditing("new")}>Add section</Button> : undefined}>
    {error && !data ? <div><Empty icon="lock" title="Couldn't load sections" text={error} /><div style={{ display: "flex", justifyContent: "center", paddingBottom: 18 }}><Button className="outline" onClick={reload}>Retry</Button></div></div>
      : !data ? <p className="a-muted" style={{ padding: 20 }} role="status">{loading ? "Loading sections…" : ""}</p>
      : data.length ? <ul className="a-list">{data.map((s) => <li key={s.id} className={s.active ? "" : "off"}>
        <span className="grow"><b>{s.title}</b><small>key: {s.key} · order {s.sortOrder} · {s.seriesIds.length} series{s.seriesIds.length ? `: ${s.seriesIds.map((i) => titles.get(i) ?? `#${i}`).join(", ")}` : ""}</small></span>
        <Pill tone="violet">{s.type}</Pill>
        {canWrite && <><Toggle label={`${s.title} active`} on={s.active} onChange={(v) => toggle(s, v)} /><RowMenu label={`Actions for ${s.title}`} items={[{ label: "Edit section", icon: "edit", onClick: () => setEditing(s) }, { label: "Delete", icon: "trash", danger: true, onClick: () => remove(s) }]} /></>}
      </li>)}</ul> : <Empty icon="home" title="No sections yet" text="Sections only appear on the home page when active and holding at least one available series." />}
    {editing && <SectionModal section={editing === "new" ? null : editing} titles={titles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </Panel>;
}

function SectionModal({ section, titles, onClose, onSaved }: { section: AdminSection | null; titles: Map<string, string>; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const [key, setKey] = useState(section?.key ?? "");
  const [title, setTitle] = useState(section?.title ?? "");
  const [type, setType] = useState<SectionType>(section?.type ?? "CAROUSEL");
  const [sortOrder, setSortOrder] = useState(String(section?.sortOrder ?? 0));
  const [active, setActive] = useState(section?.active ?? true);
  const [ids, setIds] = useState<string[]>(section?.seriesIds ?? []);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const label = (id: string) => names[id] ?? titles.get(id) ?? `Series #${id}`;
  const move = (i: number, d: -1 | 1) => setIds((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });

  const submit = async () => {
    if (!/^[a-z0-9-]{2,60}$/.test(key)) return setError("Key must be 2-60 characters: lowercase letters, digits and dashes.");
    if (!title.trim()) return setError("Add a title.");
    const so = Number(sortOrder);
    if (!Number.isInteger(so) || so < 0 || so > 10000) return setError("Sort order must be a whole number from 0 to 10000.");
    setBusy(true); setError("");
    try {
      const body = { key, title: title.trim(), type, sortOrder: so, active, seriesIds: ids };
      if (section) await sectionsApi.update(section.id, body); else await sectionsApi.create(body);
      notify(section ? "Section updated" : "Section created");
      onSaved();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return <Modal title={section ? "Edit section" : "Add section"} onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save"}</Button></>}>
    <div className="a-form one">
      <Field label="Title"><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Key" hint="Unique identifier, e.g. trending-now."><input value={key} maxLength={60} onChange={(e) => setKey(e.target.value)} /></Field>
      <div className="hp-row">
        <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value as SectionType)}>{SECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="Sort order" hint="Lower shows first."><input inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
      </div>
      <Field label="Active"><Toggle label="Active" on={active} onChange={setActive} /></Field>
      <Field label={`Series in display order (${ids.length}/50)`} hint="Only published, available series show to viewers.">
        <div>
          {ids.length < 50 && <SeriesSearch onPick={(s) => { if (!ids.includes(s.id)) { setIds([...ids, s.id]); setNames((n) => ({ ...n, [s.id]: s.title })); } }} />}
          <ul className="hp-chips">{ids.map((id, i) => <li key={id}><span>{i + 1}. {label(id)}</span>
            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={16} /></button>
            <button type="button" aria-label="Move down" disabled={i === ids.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={16} /></button>
            <button type="button" aria-label={`Remove ${label(id)}`} onClick={() => setIds(ids.filter((x) => x !== id))}><Icon name="close" size={16} /></button></li>)}</ul>
        </div>
      </Field>
      {error && <div className="a-error" role="alert">{error}</div>}
    </div>
  </Modal>;
}
