import { useMemo, useState } from "react";
import { Button, Icon, useToast } from "../../shared";
import { allSeries, bannersApi, type AdminBanner } from "../../api/admin-insights";
import { errorMessage, useAsync } from "../hooks";
import { useAdminSession } from "../session";
import { Confirm, Empty, Field, Modal, PageHead, Panel, Pill, RowMenu, Toggle, fmtDateTime, type ConfirmState } from "../ui";
import HomepageSections from "./HomepageSections";
import { SeriesSearch } from "./HomepageSeriesPicker";
import ImageUpload from "./ImageUpload";
import "./BannersPage.css";

const toLocalInput = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export default function BannersPage() {
  const { can } = useAdminSession();
  const canWrite = can("homepage.write");
  const notify = useToast();
  const banners = useAsync(() => bannersApi.list(), []);
  const series = useAsync(() => allSeries(), []);
  const titles = useMemo(() => new Map((series.data ?? []).map((s) => [s.id, s.title])), [series.data]);
  const [editing, setEditing] = useState<AdminBanner | "new" | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [busy, setBusy] = useState("");

  const asInput = (b: AdminBanner, over: Partial<AdminBanner> = {}) => { const m = { ...b, ...over }; return { title: m.title, imageKey: m.imageKey, seriesId: m.seriesId ?? undefined, linkUrl: m.linkUrl ?? undefined, active: m.active, startAt: m.startAt ?? undefined, endAt: m.endAt ?? undefined, sortOrder: m.sortOrder }; };
  const patch = async (b: AdminBanner, over: Partial<AdminBanner>, msg: string) => {
    setBusy(b.id);
    try { await bannersApi.update(b.id, asInput(b, over)); notify(msg); banners.reload(); } catch (e) { notify(errorMessage(e)); } finally { setBusy(""); }
  };
  const remove = (b: AdminBanner) => setConfirm({ title: "Delete banner?", text: `"${b.title}" will be removed from the home carousel.`, label: "Delete", danger: true, onConfirm: async () => { try { await bannersApi.remove(b.id); notify("Banner deleted"); banners.reload(); } catch (e) { notify(errorMessage(e)); } } });
  const list = banners.data ?? [];
  const status = (b: AdminBanner) => { const n = Date.now(); if (!b.active) return <Pill>Inactive</Pill>; if (b.startAt && new Date(b.startAt).getTime() > n) return <Pill tone="amber">Scheduled</Pill>; if (b.endAt && new Date(b.endAt).getTime() <= n) return <Pill tone="red">Expired</Pill>; return <Pill tone="green">Live</Pill>; };

  return <div className="a-page">
    <PageHead eyebrow="MERCHANDISING" title="Banners & homepage" sub="Hero carousel and curated sections shown on the viewer home. Viewers only see banners whose linked series is available." actions={canWrite ? <Button className="primary" icon="plus" onClick={() => setEditing("new")}>Add banner</Button> : undefined} />
    {!canWrite && <div className="a-muted" role="status">You have read-only access (homepage.write is required to change these).</div>}
    <Panel flush eyebrow="CAROUSEL" title="Banners">
      {banners.error && !banners.data ? <div><Empty icon="lock" title="Couldn't load banners" text={banners.error} /><div style={{ display: "flex", justifyContent: "center", paddingBottom: 18 }}><Button className="outline" onClick={banners.reload}>Retry</Button></div></div>
        : !banners.data ? <p className="a-muted" style={{ padding: 20 }} role="status">Loading banners…</p>
        : list.length ? <ul className="a-list">{list.map((b) => <li key={b.id} className={b.active ? "" : "off"}>
          {b.imageUrl ? <img className="hp-thumb" src={b.imageUrl} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : <span className="hp-thumb none">no image URL</span>}
          <span className="grow"><b>{b.title}</b><small>order {b.sortOrder} · {b.seriesId ? `Series: ${titles.get(b.seriesId) ?? `#${b.seriesId}`}` : b.linkUrl ? `Link: ${b.linkUrl}` : "No link"}{b.startAt ? ` · from ${fmtDateTime(b.startAt)}` : ""}{b.endAt ? ` · until ${fmtDateTime(b.endAt)}` : ""}</small></span>
          {status(b)}
          {canWrite && <><Toggle label={`${b.title} active`} on={b.active} onChange={(v) => busy !== b.id && patch(b, { active: v }, v ? "Banner activated" : "Banner deactivated")} /><RowMenu label={`Actions for ${b.title}`} items={[{ label: "Edit banner", icon: "edit", onClick: () => setEditing(b) }, { label: "Delete", icon: "trash", danger: true, onClick: () => remove(b) }]} /></>}
        </li>)}</ul> : <Empty icon="bookmark" title="No banners yet" text={canWrite ? "Add a banner to feature a series." : "Nothing has been added."} />}
    </Panel>
    <HomepageSections canWrite={canWrite} titles={titles} />
    {editing && <BannerModal banner={editing === "new" ? null : editing} titles={titles} nextOrder={list.length ? Math.max(...list.map((b) => b.sortOrder)) + 1 : 0} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); banners.reload(); }} />}
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </div>;
}

function BannerModal({ banner, titles, nextOrder, onClose, onSaved }: { banner: AdminBanner | null; titles: Map<string, string>; nextOrder: number; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const [title, setTitle] = useState(banner?.title ?? "");
  const [imageKey, setImageKey] = useState(banner?.imageKey ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(banner?.imageUrl ?? null);
  const [seriesId, setSeriesId] = useState(banner?.seriesId ?? "");
  const [seriesName, setSeriesName] = useState("");
  const [linkUrl, setLinkUrl] = useState(banner?.linkUrl ?? "");
  const [active, setActive] = useState(banner?.active ?? true);
  const [startAt, setStartAt] = useState(toLocalInput(banner?.startAt ?? null));
  const [endAt, setEndAt] = useState(toLocalInput(banner?.endAt ?? null));
  const [sortOrder, setSortOrder] = useState(String(banner?.sortOrder ?? nextOrder));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return setError("Add a title.");
    if (!imageKey) return setError("Upload a banner image.");
    if (linkUrl && !/^https:\/\//.test(linkUrl)) return setError("Link URL must start with https://");
    const so = Number(sortOrder);
    if (!Number.isInteger(so) || so < 0 || so > 10000) return setError("Sort order must be a whole number from 0 to 10000.");
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) return setError("End must be after start.");
    setBusy(true); setError("");
    try {
      const body = { title: title.trim(), imageKey, seriesId: seriesId || undefined, linkUrl: linkUrl || undefined, active, startAt: startAt ? new Date(startAt).toISOString() : undefined, endAt: endAt ? new Date(endAt).toISOString() : undefined, sortOrder: so };
      if (banner) await bannersApi.update(banner.id, body); else await bannersApi.create(body);
      notify(banner ? "Banner updated" : "Banner created");
      onSaved();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return <Modal title={banner ? "Edit banner" : "Add banner"} onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save"}</Button></>}>
    <div className="a-form one">
      <Field label="Title"><input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></Field>
      <ImageUpload wide label="Banner image" hint="Required. Wide images work best." hasImage={!!imageKey} previewUrl={imageUrl} canRemove={false} onChange={(k, u) => { if (k) { setImageKey(k); setImageUrl(u); setError(""); } }} />
      <Field label="Linked series" hint="Optional. If set, the banner only shows while that series is available.">
        <div>
          {seriesId ? <ul className="hp-chips"><li><span>{seriesName || titles.get(seriesId) || `Series #${seriesId}`}</span><button type="button" aria-label="Clear series" onClick={() => { setSeriesId(""); setSeriesName(""); }}><Icon name="close" size={16} /></button></li></ul> : <SeriesSearch onPick={(s) => { setSeriesId(s.id); setSeriesName(s.title); }} />}
        </div>
      </Field>
      <Field label="Or link URL" hint="Optional, https only."><input value={linkUrl} maxLength={500} onChange={(e) => setLinkUrl(e.target.value.trim())} placeholder="https://" /></Field>
      <div className="hp-row">
        <Field label="Start (optional)"><input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></Field>
        <Field label="End (optional)"><input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} /></Field>
      </div>
      <div className="hp-row">
        <Field label="Sort order" hint="Lower shows first."><input inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
        <Field label="Active"><Toggle label="Active" on={active} onChange={setActive} /></Field>
      </div>
      {error && <div className="a-error" role="alert">{error}</div>}
    </div>
  </Modal>;
}
