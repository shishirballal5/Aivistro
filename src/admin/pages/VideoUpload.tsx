import { useCallback, useEffect, useRef, useState } from "react";
import { Button, useToast } from "../../shared";
import { failMessage, statusLabel, statusTone, videoApi, type EpisodeRow, type VideoAssetRow } from "../../api/admin-catalog";
import { Confirm, Empty, Field, Modal, Pill, fmtDateTime, fmtDuration, type ConfirmState } from "../ui";
import "./SeriesShared.css";
import "./VideoUpload.css";

const TYPE_BY_EXT: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm" };
const MIN_BYTES = 1024, MAX_BYTES = 10_737_418_240;
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);
const ACTIVE = ["UPLOADED", "PROCESSING"];

/** Validates exactly what RequestUploadDto accepts. Returns the content type to declare, or an error. */
function check(file: File): { type: string } | { error: string } {
  const ext = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? "";
  if (!TYPE_BY_EXT[ext]) return { error: "The filename must end in .mp4, .m4v, .mov, .mkv or .webm." };
  const type = TYPE_BY_EXT[ext];
  if (file.size < MIN_BYTES) return { error: "This file is too small to be a video (minimum 1 KB)." };
  if (file.size > MAX_BYTES) return { error: "Videos can be at most 10 GB." };
  return { type };
}

function putFile(url: string, method: string, headers: Record<string, string>, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve();
      let msg = `Upload was rejected (HTTP ${x.status}).`;
      try { const b = JSON.parse(x.responseText) as { message?: string }; if (b.message) msg = b.message; } catch { /* not JSON (S3 returns XML) */ }
      reject(new Error(msg));
    };
    x.onerror = () => reject(new Error("The upload failed: couldn't reach the storage server."));
    x.onabort = () => reject(new Error("Upload cancelled."));
    x.send(file);
  });
}

export default function VideoUpload({ episode, onClose, onChanged }: { episode: EpisodeRow; onClose: () => void; onChanged: () => void }) {
  const notify = useToast();
  const [assets, setAssets] = useState<VideoAssetRow[] | null>(null);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "requesting" | "uploading" | "completing">("idle");
  const [progress, setProgress] = useState(0);
  const [formErr, setFormErr] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => videoApi.list(episode.id).then((a) => { if (alive.current) { setAssets(a); setError(""); } }, (e) => { if (alive.current) setError(failMessage(e)); }), [episode.id]);
  useEffect(() => { void load(); }, [load]);

  // Poll GET /admin/video-assets/:id every 2s for each asset that is still being processed.
  const activeIds = (assets ?? []).filter((a) => ACTIVE.includes(a.status)).map((a) => a.id).join(",");
  useEffect(() => {
    if (!activeIds) return;
    const t = window.setInterval(() => {
      activeIds.split(",").forEach((id) => videoApi.get(id).then((fresh) => {
        if (!alive.current) return;
        setAssets((p) => (p ?? []).map((a) => {
          if (a.id !== id) return a;
          if (a.status !== fresh.status && (fresh.status === "READY" || fresh.status === "FAILED")) { notify(fresh.status === "READY" ? "Video is ready" : "Video processing failed"); onChanged(); void load(); }
          return { ...a, ...fresh, current: a.current };
        }));
      }, () => undefined));
    }, 2000);
    return () => window.clearInterval(t);
  }, [activeIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (f: File | null) => {
    setFile(null); setFormErr("");
    if (!f) return;
    const r = check(f);
    if ("error" in r) setFormErr(r.error); else setFile(f);
  };
  const start = async () => {
    if (!file) return;
    const r = check(file);
    if ("error" in r) { setFormErr(r.error); return; }
    setFormErr(""); setProgress(0); setPhase("requesting");
    let assetId: string | null = null;
    try {
      const t = await videoApi.request(episode.id, { filename: file.name, contentType: r.type, sizeBytes: file.size });
      assetId = t.assetId;
      if (file.size > t.maxBytes) throw new Error(`The server accepts videos up to ${mb(t.maxBytes)}.`);
      setPhase("uploading");
      await putFile(t.upload.url, t.upload.method, t.upload.headers, file, setProgress);
      setPhase("completing");
      await videoApi.complete(t.assetId);
      notify("Upload finished. Processing started.");
      setFile(null);
      onChanged();
    } catch (e) { setFormErr(failMessage(e)); }
    finally { if (alive.current) { setPhase("idle"); void load(); } }
    void assetId;
  };
  const reprocess = (a: VideoAssetRow) => setConfirm({ title: "Reprocess video?", label: "Reprocess", danger: true, text: "The video is transcoded again from the original file. If this is the current video, playback pauses until it is READY.", onConfirm: () => { videoApi.reprocess(a.id).then(() => { notify("Reprocessing started"); void load(); onChanged(); }, (e) => notify(failMessage(e))); } });

  const busy = phase !== "idle";
  return <Modal wide title={`Video: Episode ${episode.number}`} onClose={() => { if (!busy) onClose(); }} footer={<Button className="outline" disabled={busy} onClick={onClose}>Close</Button>}>
    <div className="vu-drop">
      <Field label="Choose a video file" hint="MP4, M4V, MOV, MKV or WebM, 1 KB to 10 GB. It is uploaded straight to storage, then transcoded."><input type="file" aria-label="Video file" accept=".mp4,.m4v,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm" disabled={busy} onChange={(e) => pick(e.target.files?.[0] ?? null)} /></Field>
      {file && <div className="a-muted">{file.name} · {mb(file.size)}</div>}
      {busy && <><div className="vu-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${phase === "uploading" ? progress * 100 : phase === "completing" ? 100 : 0}%` }} /></div>
        <small className="a-muted">{phase === "requesting" ? "Requesting an upload link..." : phase === "uploading" ? `Uploading ${Math.round(progress * 100)}%` : "Verifying the upload..."}</small></>}
      {formErr && <div className="a-error" role="alert" style={{ marginTop: 0 }}>{formErr}</div>}
      <div><Button className="primary" icon="upload" disabled={!file || busy} onClick={() => void start()}>Upload video</Button></div>
    </div>
    <h3 className="heading" style={{ marginTop: 20 }}>Uploads for this episode</h3>
    {error ? <div className="a-error" role="alert">{error} <Button className="outline" onClick={() => void load()}>Retry</Button></div>
      : !assets ? <Empty icon="upload" title="Loading..." />
      : !assets.length ? <Empty icon="upload" title="No videos yet" text="Upload a video to make this episode publishable." />
      : assets.map((a) => <AssetCard key={a.id} a={a} onReprocess={() => reprocess(a)} />)}
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </Modal>;
}

function AssetCard({ a, onReprocess }: { a: VideoAssetRow; onReprocess: () => void }) {
  const notify = useToast();
  const [subs, setSubs] = useState<{ language: string; label: string }[] | null>(null);
  const [lang, setLang] = useState("en");
  const [label, setLabel] = useState("English");
  const [vtt, setVtt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSubs = () => videoApi.get(a.id).then((d) => setSubs(d.subtitles ?? []), (e) => notify(failMessage(e)));
  const add = async () => {
    if (vtt === null) return;
    setBusy(true);
    try { await videoApi.addSubtitle(a.id, { language: lang.trim(), label: label.trim(), vtt }); notify("Subtitle saved"); setVtt(null); await loadSubs(); } catch (e) { notify(failMessage(e)); } finally { setBusy(false); }
  };
  const remove = (l: string) => videoApi.removeSubtitle(a.id, l).then(() => { notify("Subtitle removed"); return loadSubs(); }, (e) => notify(failMessage(e)));
  return <div className="vu-asset">
    <header><span className="vu-name">{a.filename}</span><span className="sx-bar">{a.current && <Pill tone="violet">Current</Pill>}<Pill tone={statusTone(a.status)}>{statusLabel(a.status)}</Pill></span></header>
    <div className="vu-facts"><span>{a.sizeBytes ? mb(a.sizeBytes) : "size pending"}</span><span>Created {fmtDateTime(a.createdAt)}</span>{a.durationSeconds != null && <span>Duration {fmtDuration(a.durationSeconds)}</span>}{a.width && a.height && <span>Source {a.width}x{a.height}</span>}{a.processingAttempts > 0 && <span>Attempts {a.processingAttempts}</span>}{a.processedAt && <span>Processed {fmtDateTime(a.processedAt)}</span>}</div>
    {ACTIVE.includes(a.status) && <small className="a-muted">Processing on the server. This updates automatically every 2 seconds.</small>}
    {a.variants.length > 0 && <div className="vu-facts"><span>Renditions:</span>{a.variants.map((v) => <Pill key={v.name} tone="blue">{v.name} {v.width}x{v.height}</Pill>)}</div>}
    {a.failureReason && <div className="a-error" style={{ margin: 0 }}>{a.failureReason}</div>}
    <div className="sx-bar">{(a.status === "READY" || a.status === "FAILED") && <Button className="outline" onClick={onReprocess}>Reprocess</Button>}{a.status === "READY" && subs === null && <Button className="outline" onClick={() => void loadSubs()}>Subtitles</Button>}</div>
    {subs && <div className="vu-subs">
      {subs.length ? subs.map((s) => <div className="sx-bar" key={s.language}><Pill tone="grey">{s.language}</Pill><span>{s.label}</span><Button className="outline" onClick={() => void remove(s.language)}>Remove</Button></div>) : <span className="a-muted">No subtitles yet.</span>}
      <div className="sx-inline"><input aria-label="Language code" value={lang} onChange={(e) => setLang(e.target.value)} style={{ maxWidth: 90 }} placeholder="en" /><input aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
        <input type="file" aria-label="WebVTT file" accept=".vtt,text/vtt" onChange={(e) => { const f = e.target.files?.[0]; if (!f) { setVtt(null); return; } void f.text().then(setVtt); }} />
        <Button className="outline" disabled={busy || vtt === null || !lang.trim() || !label.trim()} onClick={() => void add()}>Add subtitle</Button></div>
      <small className="a-muted">WebVTT only (file must start with WEBVTT). Re-adding a language replaces it.</small>
    </div>}
  </div>;
}
