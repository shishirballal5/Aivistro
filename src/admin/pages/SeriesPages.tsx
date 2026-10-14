import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Icon, useToast } from "../../shared";
import { catalogApi, failMessage, LANGUAGES, RATINGS, statusLabel, statusTone, type CastMember, type Named, type SeriesDetail, type SeriesRow } from "../../api/admin-catalog";
import ImageUpload from "./ImageUpload";
import { useAdminSession } from "../session";
import { Confirm, Empty, Field, PageHead, Panel, Pill, RowMenu, SearchBox, fmtDateTime, type ConfirmState, type MenuItem } from "../ui";
import { useAsync } from "../hooks";
import { ACTION_ICON, ACTION_LABEL, allowedActions, useTransitions } from "./SeriesShared";

const STATUSES = ["ALL", "PUBLISHED", "SCHEDULED", "DRAFT", "ARCHIVED"] as const;

export function SeriesList({ go }: { go: (p: string) => void }) {
  const { can } = useAdminSession();
  const notify = useToast();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("ALL");
  const [rows, setRows] = useState<SeriesRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<{ loading: boolean; more: boolean; error: string }>({ loading: true, more: false, error: "" });
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const seq = useRef(0);

  useEffect(() => { const t = window.setTimeout(() => setTerm(q.trim()), 300); return () => window.clearTimeout(t); }, [q]);

  const load = useCallback(async (cursor?: string | null) => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: !cursor, more: !!cursor, error: "" }));
    try {
      const r = await catalogApi.listSeries({ q: term || undefined, status: status === "ALL" ? undefined : status, cursor });
      if (id !== seq.current) return;
      setRows((p) => (cursor ? [...p, ...r.items] : r.items));
      setNext(r.nextCursor);
      setState({ loading: false, more: false, error: "" });
    } catch (e) { if (id === seq.current) setState({ loading: false, more: false, error: failMessage(e) }); }
  }, [term, status]);
  useEffect(() => { void load(); }, [load]);

  const tx = useTransitions("series", "Series", () => void load());
  const remove = (s: SeriesRow) => setConfirm({ title: "Delete series?", label: "Delete series", danger: true, text: `"${s.title}" will be permanently removed. Only draft series without episodes can be deleted.`,
    onConfirm: () => { catalogApi.deleteSeries(s.id).then(() => { notify("Series deleted"); void load(); }, (e) => notify(failMessage(e))); } });

  const menu = (s: SeriesRow): MenuItem[] => [
    ...(can("catalog.write") ? [{ label: "Edit details", icon: "edit" as const, onClick: () => go(`series/${s.id}/edit`) }] : []),
    { label: "Manage episodes", icon: "series", onClick: () => go(`episodes/${s.id}`) },
    ...allowedActions(s.status, can("catalog.publish")).map((a) => ({ label: ACTION_LABEL[a], icon: ACTION_ICON[a], danger: a === "archive", onClick: () => tx.request(s, a) })),
    ...(can("catalog.write") && s.status === "DRAFT" ? [{ label: "Delete", icon: "trash" as const, danger: true, onClick: () => remove(s) }] : []),
  ];

  return <div className="a-page">
    <PageHead eyebrow="CONTENT LIBRARY" title="Series" sub="Manage every story in your catalog." actions={can("catalog.write") ? <Button className="primary" icon="plus" onClick={() => go("series/new")}>Create new series</Button> : undefined} />
    <div className="a-tabs wide" role="tablist" aria-label="Status">{STATUSES.map((k) => <button type="button" role="tab" aria-selected={status === k} key={k} className={status === k ? "active" : ""} onClick={() => setStatus(k)}>{k === "ALL" ? "All" : statusLabel(k)}</button>)}</div>
    <Panel flush>
      <div className="a-toolbar"><SearchBox value={q} onChange={setQ} placeholder="Search series by title..." />{(q || status !== "ALL") && <Button className="outline" onClick={() => { setQ(""); setStatus("ALL"); }}>Clear filters</Button>}</div>
      {state.error ? <div className="a-error" role="alert">{state.error} <Button className="outline" onClick={() => void load()}>Retry</Button></div>
        : state.loading ? <Empty icon="series" title="Loading series..." />
        : rows.length ? <div className="a-table-wrap"><table className="a-table"><thead><tr><th>Series</th><th>Status</th><th>Updated</th><th /></tr></thead><tbody>
          {rows.map((s) => <tr key={s.id}>
            <td><span className="a-cell">{s.posterUrl ? <img src={s.posterUrl} alt="" /> : <span className="sx-thumb" />}<span><b>{s.title}</b><small>{LANGUAGES.find(([c]) => c === s.language)?.[1] ?? s.language} · {s.maturityRating}{s.isFeatured ? " · Featured" : ""}</small></span></span></td>
            <td><Pill tone={statusTone(s.status)}>{statusLabel(s.status)}</Pill>{s.status === "SCHEDULED" && s.publishAt && <small className="a-sub">{fmtDateTime(s.publishAt)}</small>}</td>
            <td>{fmtDateTime(s.updatedAt)}</td>
            <td><RowMenu label={`Actions for ${s.title}`} items={menu(s)} /></td></tr>)}
        </tbody></table></div> : <Empty title="No series found" text={term || status !== "ALL" ? "Try a different search or clear the filters." : "Create the first series to get started."} />}
      {next && !state.error && <div className="sx-more"><Button className="outline" disabled={state.more} onClick={() => void load(next)}>{state.more ? "Loading..." : "Load more"}</Button></div>}
    </Panel>
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
    {tx.ui}
  </div>;
}

type Form = { title: string; synopsis: string; language: string; maturityRating: string; releaseYear: string; posterKey: string; bannerKey: string; sortWeight: string; isFeatured: boolean; genreIds: string[]; categoryIds: string[]; cast: { castMemberId: string; roleName: string }[] };
const empty: Form = { title: "", synopsis: "", language: "hi", maturityRating: "16+", releaseYear: "", posterKey: "", bannerKey: "", sortWeight: "0", isFeatured: false, genreIds: [], categoryIds: [], cast: [] };
const fromSeries = (s: SeriesDetail): Form => ({ title: s.title, synopsis: s.synopsis, language: s.language, maturityRating: s.maturityRating, releaseYear: s.releaseYear ? String(s.releaseYear) : "", posterKey: s.posterKey ?? "", bannerKey: s.bannerKey ?? "", sortWeight: String(s.sortWeight), isFeatured: s.isFeatured, genreIds: s.genres.map((g) => g.id), categoryIds: s.categories.map((c) => c.id), cast: s.cast.map((c) => ({ castMemberId: c.castMemberId, roleName: c.roleName ?? "" })) });

export function SeriesForm({ id, go }: { id?: string; go: (p: string) => void }) {
  const { can } = useAdminSession();
  const detail = useAsync(() => (id ? catalogApi.getSeries(id) : Promise.resolve(null)), [id]);
  if (id && detail.loading && !detail.data) return <div className="a-page"><Empty icon="series" title="Loading series..." /></div>;
  if (id && detail.error) return <div className="a-page"><PageHead eyebrow="EDIT SERIES" title="Series" back={{ label: "Back to series", onClick: () => go("series") }} /><div className="a-error" role="alert">{detail.error} <Button className="outline" onClick={detail.reload}>Retry</Button></div></div>;
  if (!can("catalog.write")) return <div className="a-page"><PageHead eyebrow="SERIES" title="Series" back={{ label: "Back to series", onClick: () => go("series") }} /><Empty icon="lock" title="You don't have permission" text="Editing series needs the catalog.write permission." /></div>;
  return <FormBody key={detail.data?.id ?? "new"} series={detail.data} go={go} reload={detail.reload} />;
}

function Picker({ label, items, value, onChange, onCreate, canCreate, noun }: { label: string; items: Named[]; value: string[]; onChange: (v: string[]) => void; onCreate: (name: string) => Promise<Named>; canCreate: boolean; noun: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const notify = useToast();
  const toggle = (i: string) => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i]);
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { const c = await onCreate(name.trim()); onChange([...value, c.id]); setName(""); notify(`${noun} created`); } catch (e) { notify(failMessage(e)); } finally { setBusy(false); }
  };
  return <div className="a-field full" role="group" aria-label={label}><span>{label}</span>{value.length > 20 && <small>At most 20</small>}<div>
    <div className="sx-chips">{items.length ? items.map((g) => <button type="button" key={g.id} className={`sx-chip ${value.includes(g.id) ? "on" : ""}`} aria-pressed={value.includes(g.id)} onClick={() => toggle(g.id)}>{g.name}</button>) : <span className="a-muted">None yet.</span>}</div>
    {canCreate && <div className="sx-inline"><input value={name} placeholder={`New ${noun.toLowerCase()} name`} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} /><Button className="outline" disabled={busy || !name.trim()} onClick={() => void add()}>Add {noun.toLowerCase()}</Button></div>}
  </div></div>;
}

function FormBody({ series, go, reload }: { series: SeriesDetail | null; go: (p: string) => void; reload: () => void }) {
  const { can } = useAdminSession();
  const notify = useToast();
  const [f, setF] = useState<Form>(series ? fromSeries(series) : empty);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [genres, setGenres] = useState<Named[]>([]);
  const [cats, setCats] = useState<Named[]>([]);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [castName, setCastName] = useState("");
  // Preview URLs come from the server (saved series, or the upload response); keys are what gets saved.
  const [urls, setUrls] = useState<{ posterKey: string | null; bannerKey: string | null }>({ posterKey: series?.posterUrl ?? null, bannerKey: series?.bannerUrl ?? null });
  const [saved, setSaved] = useState<SeriesDetail | null>(series);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((p) => ({ ...p, [k]: v })); setError(""); };
  const tx = useTransitions("series", "Series", () => { if (saved) void catalogApi.getSeries(saved.id).then(setSaved).catch(() => undefined); reload(); });

  useEffect(() => {
    catalogApi.genres().then(setGenres, () => undefined);
    catalogApi.categories().then(setCats, () => undefined);
    catalogApi.cast().then(setCast, () => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const orig = (k: "posterKey" | "bannerKey") => saved?.[k] ?? "";
  const keyPatch = (k: "posterKey" | "bannerKey") => (f[k] === orig(k) ? {} : { [k]: f[k] || null }); // changed: new key, or null to remove
  const validate = () => {
    if (!f.title.trim()) return "Add a series title.";
    if (f.title.length > 200) return "Title can be at most 200 characters.";
    if (f.synopsis.length > 5000) return "Synopsis can be at most 5000 characters.";
    if (f.releaseYear && (!/^\d{4}$/.test(f.releaseYear) || Number(f.releaseYear) < 1950 || Number(f.releaseYear) > 2100)) return "Release year must be between 1950 and 2100.";
    const sw = Number(f.sortWeight);
    if (!Number.isInteger(sw) || sw < -1000 || sw > 1000) return "Sort weight must be a whole number from -1000 to 1000.";
    return (f.genreIds.length > 20 ? "Pick at most 20 genres." : "");
  };
  const save = async () => {
    const m = validate();
    if (m) { setError(m); return; }
    const body = {
      title: f.title.trim(), synopsis: f.synopsis, language: f.language, maturityRating: f.maturityRating, sortWeight: Number(f.sortWeight), isFeatured: f.isFeatured,
      ...(f.releaseYear ? { releaseYear: Number(f.releaseYear) } : {}), ...keyPatch("posterKey"), ...keyPatch("bannerKey"),
      genreIds: f.genreIds, categoryIds: f.categoryIds, cast: f.cast.filter((c) => c.castMemberId).map((c, i) => ({ castMemberId: c.castMemberId, roleName: c.roleName.trim() || undefined, billingOrder: i })),
    };
    setSaving(true);
    try {
      if (saved) { const s = await catalogApi.updateSeries(saved.id, body); setSaved(s); setF(fromSeries(s)); setUrls({ posterKey: s.posterUrl, bannerKey: s.bannerUrl }); notify("Series saved"); }
      else { const s = await catalogApi.createSeries(body); notify("Series created. Now add its episodes."); go(`series/${s.id}/edit`); }
    } catch (e) { setError(failMessage(e)); } finally { setSaving(false); }
  };

  const pick = (k: "posterKey" | "bannerKey") => (key: string | null, url: string | null) => { set(k, key ?? ""); setUrls((p) => ({ ...p, [k]: url })); };
  const addCast = async () => {
    try { const c = await catalogApi.createCast(castName.trim()); setCast((p) => [...p, c]); set("cast", [...f.cast, { castMemberId: c.id, roleName: "" }]); setCastName(""); notify("Cast member created"); } catch (e) { notify(failMessage(e)); }
  };

  return <div className="a-page">
    <PageHead eyebrow={saved ? "EDIT SERIES" : "NEW CONTENT"} title={saved ? saved.title : "Create a series"} sub="Series start as drafts. Publishing needs a title, a synopsis, a poster, a genre and a published episode." back={{ label: "Back to series", onClick: () => go("series") }}
      actions={<>{saved && <Button className="outline" icon="series" onClick={() => go(`episodes/${saved.id}`)}>Episodes</Button>}<Button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : saved ? "Save changes" : "Create series"}</Button></>} />
    {saved && <Panel eyebrow="STATUS" title="Publishing">
      <div className="sx-bar"><Pill tone={statusTone(saved.status)}>{statusLabel(saved.status)}</Pill>
        {allowedActions(saved.status, can("catalog.publish")).map((a) => <Button key={a} className={a === "archive" ? "outline" : "primary"} icon={ACTION_ICON[a]} disabled={tx.busy} onClick={() => tx.request(saved, a)}>{ACTION_LABEL[a]}</Button>)}
        {!can("catalog.publish") && <span className="a-muted">You don't have permission to publish.</span>}</div>
      <div className="sx-meta"><span>Updated {fmtDateTime(saved.updatedAt)}</span><span>Created {fmtDateTime(saved.createdAt)}</span>{saved.publishedAt && <span>Published {fmtDateTime(saved.publishedAt)}</span>}{saved.status === "SCHEDULED" && saved.publishAt && <span>Goes live {fmtDateTime(saved.publishAt)}</span>}</div>
    </Panel>}
    <Panel eyebrow="DETAILS" title="Tell us about the story">
      <div className="a-form">
        <Field full label="Series title" hint={`${f.title.length}/200`}><input value={f.title} maxLength={200} onChange={(e) => set("title", e.target.value)} placeholder="e.g. What She Left Behind" /></Field>
        <Field full label="Synopsis" hint={`${f.synopsis.length}/5000. At least 10 characters needed to publish.`}><textarea value={f.synopsis} onChange={(e) => set("synopsis", e.target.value)} placeholder="A captivating summary in 2-3 sentences..." /></Field>
        <Field label="Language"><select value={f.language} onChange={(e) => set("language", e.target.value)}>{LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></Field>
        <Field label="Maturity rating"><select value={f.maturityRating} onChange={(e) => set("maturityRating", e.target.value)}>{RATINGS.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Release year" hint="Optional"><input inputMode="numeric" value={f.releaseYear} maxLength={4} onChange={(e) => set("releaseYear", e.target.value.replace(/\D/g, ""))} placeholder="2026" /></Field>
        <Field label="Sort weight" hint="Higher shows earlier (-1000 to 1000)"><input inputMode="numeric" value={f.sortWeight} onChange={(e) => set("sortWeight", e.target.value)} /></Field>
        <Field label="Featured"><select value={f.isFeatured ? "1" : "0"} onChange={(e) => set("isFeatured", e.target.value === "1")}><option value="0">Not featured</option><option value="1">Featured</option></select></Field>
        <Picker label="Genres (at least one to publish)" items={genres} value={f.genreIds} onChange={(v) => set("genreIds", v)} onCreate={async (n) => { const g = await catalogApi.createGenre(n); setGenres((p) => [...p, g]); return g; }} canCreate={can("catalog.write")} noun="Genre" />
        <Picker label="Categories" items={cats} value={f.categoryIds} onChange={(v) => set("categoryIds", v)} onCreate={async (n) => { const g = await catalogApi.createCategory(n); setCats((p) => [...p, g]); return g; }} canCreate={can("catalog.write")} noun="Category" />
      </div>
    </Panel>
    <Panel eyebrow="ARTWORK" title="Poster and banner">
      <div className="a-form one">
        <ImageUpload label="Poster (required to publish)" hint="Portrait poster." hasImage={!!f.posterKey} previewUrl={urls.posterKey} onChange={pick("posterKey")} disabled={!can("catalog.write")} />
        <ImageUpload wide label="Banner" hint="Optional wide banner." hasImage={!!f.bannerKey} previewUrl={urls.bannerKey} onChange={pick("bannerKey")} disabled={!can("catalog.write")} />
        <small className="a-muted">Uploaded images are attached when you press Save. Removing an image takes effect on save too.</small>
      </div>
    </Panel>
    <Panel eyebrow="CAST" title="Cast">
      {f.cast.map((c, i) => <div className="sx-cast" key={i}>
        <select aria-label="Cast member" value={c.castMemberId} onChange={(e) => set("cast", f.cast.map((x, j) => (j === i ? { ...x, castMemberId: e.target.value } : x)))}><option value="">Select cast member</option>{cast.map((m) => <option key={m.id} value={m.id} disabled={f.cast.some((x, j) => j !== i && x.castMemberId === m.id)}>{m.name}</option>)}</select>
        <input aria-label="Role" placeholder="Role (optional)" maxLength={100} value={c.roleName} onChange={(e) => set("cast", f.cast.map((x, j) => (j === i ? { ...x, roleName: e.target.value } : x)))} />
        <Button className="outline" onClick={() => set("cast", f.cast.filter((_, j) => j !== i))}>Remove</Button></div>)}
      <div className="sx-inline"><Button className="outline" icon="plus" onClick={() => set("cast", [...f.cast, { castMemberId: "", roleName: "" }])}>Add cast row</Button>
        <input value={castName} placeholder="Or create a new cast member" maxLength={120} onChange={(e) => setCastName(e.target.value)} /><Button className="outline" disabled={!castName.trim()} onClick={() => void addCast()}>Create</Button></div>
    </Panel>
    {error && <div className="a-error" role="alert">{error}</div>}
    <div className="sx-actions-row"><Button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : saved ? "Save changes" : "Create series"}</Button><Button className="outline" onClick={() => go("series")}>Cancel</Button></div>
    {tx.ui}
  </div>;
}
