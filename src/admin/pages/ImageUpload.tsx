import { useRef, useState, type DragEvent } from "react";
import { Button } from "../../shared";
import { failMessage, imageFileProblem, uploadImage } from "../../api/admin-catalog";
import { ApiError } from "../../api/http";
import "./ImageUpload.css";

const message = (e: unknown) => (e instanceof ApiError && e.status === 401 ? "Your session has expired. Sign in again, then retry." : failMessage(e));

/**
 * Image picker for poster / banner / thumbnail fields: choose or drop a file, it is checked here, uploaded with progress
 * straight to storage, verified by the server, then shown from the URL the server returns. `onChange(null, null)` means "remove".
 * The parent owns the key; this component owns only the transient upload state.
 */
export default function ImageUpload({ label, hint, previewUrl, hasImage, onChange, wide, canRemove = true, disabled }: {
  label: string; hint?: string; previewUrl: string | null; hasImage: boolean; onChange: (key: string | null, url: string | null) => void; wide?: boolean; canRemove?: boolean; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const [broken, setBroken] = useState(false);

  const start = async (file: File | undefined | null) => {
    if (!file || busy) return;
    const problem = imageFileProblem(file);
    if (problem) { setErr(problem); return; }
    setErr(""); setBusy(true); setProgress(0);
    try {
      const done = await uploadImage(file, setProgress);
      setBroken(false);
      onChange(done.key, done.url);
    } catch (e) { setErr(message(e)); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (!disabled) void start(e.dataTransfer.files?.[0]); };

  return <div className={`iu ${wide ? "wide" : ""}`}>
    <span className="iu-label">{label}</span>
    <div className={`iu-row ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <div className="iu-box">{previewUrl && !broken ? <img src={previewUrl} alt={`${label} preview`} onError={() => setBroken(true)} /> : <span>{hasImage ? "Saved (no preview)" : "No image"}</span>}</div>
      <div className="iu-side">
        <input ref={input} type="file" hidden aria-label={label} accept="image/jpeg,image/png,image/webp" disabled={disabled || busy} onChange={(e) => void start(e.target.files?.[0])} />
        <div className="iu-actions">
          <Button className="outline" icon="upload" disabled={disabled || busy} onClick={() => input.current?.click()}>{hasImage ? "Replace image" : "Choose image"}</Button>
          {canRemove && hasImage && <Button className="outline" disabled={disabled || busy} onClick={() => { setErr(""); onChange(null, null); }}>Remove</Button>}
        </div>
        <small className="a-muted">{hint ? `${hint} ` : ""}Drop a file here or choose one. JPEG, PNG or WebP, up to 5 MB.</small>
        {busy && <><div className="iu-progress" role="progressbar" aria-label={`${label} upload`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${progress * 100}%` }} /></div>
          <small className="a-muted">{progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Verifying the image..."}</small></>}
        {err && <div className="a-error" role="alert">{err}</div>}
      </div>
    </div>
  </div>;
}
