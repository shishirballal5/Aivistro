import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Icon, useToast } from "../../shared";
import { catalogApi, failMessage, statusLabel, statusTone, videoApi, type EpisodeRow, type SeriesRow, type VideoAssetRow } from "../../api/admin-catalog";
import { useAdminSession } from "../session";
import { useAsync } from "../hooks";
import { Confirm, Empty, Field, Modal, PageHead, Panel, Pill, RowMenu, SearchBox, fmtDateTime, fmtDuration, type ConfirmState } from "../ui";
import { ACTION_ICON, ACTION_LABEL, allowedActions, useTransitions } from "./SeriesShared";
import ImageUpload from "./ImageUpload";
import VideoUpload from "./VideoUpload";

export default function EpisodesPage({ seriesId, go }: { seriesId?: string; go: (p: string) => void }) {
  return seriesId ? <Manager key={seriesId} seriesId={seriesId} go={go} /> : <Picker go={go} />;
}

function Picker({ go }: { go: (p: string) => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<SeriesRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [st, setSt] = useState({ loading: true, more: false, error: "" });
  const seq = useRef(0);
  useEffect(() => { const t = window.setTimeout(() => setTerm(q.trim()), 300); return () => window.clearTimeout(t); }, [q]);
  const load = useCallback(async (cursor?: string | null) => {
    const id = ++seq.current;
    setSt((s) => ({ ...s, loading: !cursor, more: !!cursor, error: "" }));
    try { const r = await catalogApi.listSeries({ q: term || undefined, cursor }); if (id !== seq.current) return; setRows((p) => (cursor ? [...p, ...r.items] : r.items)); setNext(r.nextCursor); setSt({ loading: false, more: false, error: "" }); }
    catch (e) { if (id === seq.current) setSt({ loading: false, more: false, error: failMessage(e) }); }
  }, [term]);
  useEffect(() => { void load(); }, [load]);
  return <div className="a-page">
    <PageHead eyebrow="CONTENT LIBRARY" title="Episodes" sub="Pick a series to add episodes, upload video and publish." />
    <Panel flush>
      <div className="a-toolbar"><SearchBox value={q} onChange={setQ} placeholder="Search series by title..." /></div>
      <div style={{ padding: 16 }}>
        {st.error ? <div className="a-error" role="alert">{st.error} <Button className="outline" onClick={() => void load()}>Retry</Button></div>
          : st.loading ? <Empty icon="series" title="Loading series..." />
          : rows.length ? <div className="a-cards">{rows.map((s) => <button type="button" key={s.id} className="a-series-card" onClick={() => go(`episodes/${s.id}`)}>{s.posterUrl ? <img src={s.posterUrl} alt="" /> : <span className="sx-thumb" />}<span><b>{s.title}</b><Pill tone={statusTone(s.status)}>{statusLabel(s.status)}</Pill></span></button>)}</div>
          : <Empty title="No series found" text="Create a series first, then add its episodes." />}
      </div>
      {next && !st.error && <div className="sx-more"><Button className="outline" disabled={st.more} onClick={() => void load(next)}>{st.more ? "Loading..." : "Load more"}</Button></div>}
    </Panel>
  </div>;
}

type Video = { status: VideoAssetRow["status"] | "NONE" };

function Manager({ seriesId, go }: { seriesId: string; go: (p: string) => void }) {
  const { can } = useAdminSession();
  const notify = useToast();
  const series = useAsync(() => catalogApi.getSeries(seriesId), [seriesId]);
  const eps = useAsync(() => catalogApi.listEpisodes(seriesId), [seriesId]);
  const [videos, setVideos] = useState<Record<string, Video>>({});
  const [editing, setEditing] = useState<EpisodeRow | "new" | null>(null);
  const [uploading, setUploading] = useState<EpisodeRow | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [moving, setMoving] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const tx = useTransitions("episodes", "Episode", () => { eps.reload(); series.reload(); });

  // Current asset status per episode (needs video.manage).
  const list = eps.data;
  useEffect(() => {
    if (!list || !can("video.manage")) return;
    let live = true;
    Promise.all(list.filter((e) => e.hasVideo).map((e) => videoApi.list(e.id).then((a) => [e.id, { status: (a.find((x) => x.current) ?? a[0])?.status ?? "NONE" }] as const, () => [e.id, { status: "NONE" }] as const)))
      .then((pairs) => { if (live) setVideos(Object.fromEntries(pairs) as Record<string, Video>); });
    return () => { live = false; };
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (e: EpisodeRow) => setConfirm({ title: "Delete episode?", label: "Delete episode", danger: true, text: `Episode ${e.number} "${e.title}" will be permanently removed. Only drafts without a video can be deleted; archive it otherwise.`,
    onConfirm: () => { catalogApi.deleteEpisode(e.id).then(() => { notify("Episode deleted"); eps.reload(); }, (err) => notify(failMessage(err))); } });
  // One atomic request: the server renumbers 1..n in the given order (no temporary numbers, no half-moved lists).
  const move = async (e: EpisodeRow, dir: -1 | 1) => {
    const l = [...(eps.data ?? [])];
    const i = l.findIndex((x) => x.id === e.id), j = i + dir;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    setMoving(true);
    try { await catalogApi.reorderEpisodes(seriesId, l.map((x) => x.id)); } catch (err) { notify(failMessage(err)); } finally { setMoving(false); eps.reload(); }
  };
  const dropOn = async (target: string) => {
    const l = eps.data ?? [];
    if (!drag || drag === target) { setDrag(null); return; }
    const ids = l.map((x) => x.id).filter((id) => id !== drag);
    ids.splice(ids.indexOf(target) + (l.findIndex((x) => x.id === drag) < l.findIndex((x) => x.id === target) ? 1 : 0), 0, drag);
    setDrag(null); setMoving(true);
    try { await catalogApi.reorderEpisodes(seriesId, ids); } catch (err) { notify(failMessage(err)); } finally { setMoving(false); eps.reload(); }
  };

  const s = series.data;
  const list2 = eps.data ?? [];
  return <div className="a-page">
    <PageHead eyebrow="EPISODES" title={s?.title ?? "Episodes"} sub={s ? `${list2.length} episodes · ${list2.filter((e) => e.status === "PUBLISHED").length} published · series is ${statusLabel(s.status)}` : undefined} back={{ label: "All series", onClick: () => go("episodes") }}
      actions={<>{can("catalog.write") && <Button className="outline" icon="edit" onClick={() => go(`series/${seriesId}/edit`)}>Series details</Button>}{can("catalog.write") && <Button className="primary" icon="plus" onClick={() => setEditing("new")}>Add episode</Button>}</>} />
    {series.error && <div className="a-error" role="alert">{series.error} <Button className="outline" onClick={series.reload}>Retry</Button></div>}
    <Panel flush>
      {eps.error ? <div className="a-error" role="alert">{eps.error} <Button className="outline" onClick={eps.reload}>Retry</Button></div>
        : eps.loading && !eps.data ? <Empty icon="series" title="Loading episodes..." />
        : list2.length ? <div className="a-table-wrap"><table className="a-table"><thead><tr><th>#</th><th>Episode</th><th>Duration</th><th>Video</th><th>Status</th><th /></tr></thead><tbody>
          {list2.map((e, i) => { const v = videos[e.id]; return <tr key={e.id} draggable={can("catalog.write") && !moving} onDragStart={() => setDrag(e.id)} onDragEnd={() => setDrag(null)} onDragOver={(ev) => { if (drag) ev.preventDefault(); }} onDrop={() => void dropOn(e.id)} style={drag === e.id ? { opacity: 0.5 } : undefined}>
            <td className="a-num">{e.number}</td>
            <td><span className="a-cell">{e.thumbnailUrl && <img src={e.thumbnailUrl} alt="" style={{ width: 64, height: 36, objectFit: "cover", borderRadius: 6 }} />}<span><b>{e.title}</b><small>{e.description ? e.description.slice(0, 70) : "No description"}</small></span></span></td>
            <td>{e.durationSeconds ? fmtDuration(e.durationSeconds) : "—"}</td>
            <td>{!e.hasVideo ? <Pill tone="grey">No video</Pill> : v ? <Pill tone={statusTone(v.status)}>{v.status === "NONE" ? "Has video" : statusLabel(v.status)}</Pill> : <Pill tone="blue">Has video</Pill>}</td>
            <td><Pill tone={statusTone(e.status)}>{statusLabel(e.status)}</Pill>{e.status === "SCHEDULED" && e.publishAt && <small className="a-sub">{fmtDateTime(e.publishAt)}</small>}</td>
            <td><div className="a-row-actions">
              {can("catalog.write") && <><button type="button" aria-label={`Move episode ${e.number} up`} disabled={i === 0 || moving} onClick={() => void move(e, -1)}><Icon name="up" size={16} /></button><button type="button" aria-label={`Move episode ${e.number} down`} disabled={i === list2.length - 1 || moving} onClick={() => void move(e, 1)}><Icon name="down" size={16} /></button></>}
              <RowMenu label={`Actions for episode ${e.number}`} items={[
                ...(can("video.manage") ? [{ label: e.hasVideo ? "Video & uploads" : "Upload video", icon: "upload" as const, onClick: () => setUploading(e) }] : []),
                ...(can("catalog.write") ? [{ label: "Edit episode", icon: "edit" as const, onClick: () => setEditing(e) }] : []),
                ...allowedActions(e.status, can("catalog.publish")).map((a) => ({ label: ACTION_LABEL[a], icon: ACTION_ICON[a], danger: a === "archive", onClick: () => tx.request(e, a) })),
                ...(can("catalog.write") && e.status === "DRAFT" && !e.hasVideo ? [{ label: "Delete", icon: "trash" as const, danger: true, onClick: () => remove(e) }] : []),
              ]} /></div></td></tr>; })}
        </tbody></table></div> : <Empty icon="series" title="No episodes yet" text="Add the first episode, then upload its video." />}
    </Panel>
    {editing && <EpisodeModal seriesId={seriesId} ep={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); eps.reload(); }} />}
    {uploading && <VideoUpload episode={uploading} onClose={() => { setUploading(null); eps.reload(); }} onChanged={() => eps.reload()} />}
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
    {tx.ui}
  </div>;
}

function EpisodeModal({ seriesId, ep, onClose, onSaved }: { seriesId: string; ep: EpisodeRow | null; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const [num, setNum] = useState(ep ? String(ep.number) : "");
  const [title, setTitle] = useState(ep?.title ?? "");
  const [desc, setDesc] = useState(ep?.description ?? "");
  const [thumb, setThumb] = useState<string | null>(ep?.thumbnailKey ?? null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(ep?.thumbnailUrl ?? null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!title.trim()) { setErr("Add an episode title."); return; }
    if (num && (!/^\d+$/.test(num) || Number(num) < 1 || Number(num) > 10000)) { setErr("Episode number must be between 1 and 10000."); return; }
    setBusy(true);
    try {
      if (ep) await catalogApi.updateEpisode(ep.id, { title: title.trim(), description: desc, ...(num ? { number: Number(num) } : {}), ...(thumb !== (ep.thumbnailKey ?? null) ? { thumbnailKey: thumb } : {}) });
      else await catalogApi.createEpisode(seriesId, { title: title.trim(), ...(desc ? { description: desc } : {}), ...(num ? { number: Number(num) } : {}), ...(thumb ? { thumbnailKey: thumb } : {}) });
      notify(ep ? "Episode saved" : "Episode created");
      onSaved();
    } catch (e) { setErr(failMessage(e)); setBusy(false); }
  };
  return <Modal title={ep ? `Edit episode ${ep.number}` : "Add episode"} onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : ep ? "Save" : "Create"}</Button></>}>
    <div className="a-form one">
      <Field label="Episode number" hint={ep ? undefined : "Leave blank to add after the last episode"}><input inputMode="numeric" value={num} onChange={(e) => { setNum(e.target.value.replace(/\D/g, "")); setErr(""); }} placeholder="Auto" /></Field>
      <Field label="Title"><input value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setErr(""); }} /></Field>
      <Field label="Description" hint="Optional"><textarea value={desc} maxLength={5000} onChange={(e) => setDesc(e.target.value)} /></Field>
      <ImageUpload wide label="Thumbnail" hint="Optional." hasImage={!!thumb} previewUrl={thumbUrl} onChange={(k, u) => { setThumb(k); setThumbUrl(u); setErr(""); }} />
      {err && <div className="a-error" role="alert">{err}</div>}
    </div>
  </Modal>;
}
