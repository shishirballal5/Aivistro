import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/http";
import { accountApi } from "../api/viewer-account";
import { Button, useToast } from "../shared";
import { errorText } from "./model";
import { useApp } from "./store";
import "./AccountData.css";

const isoDay = () => new Date().toISOString().slice(0, 10);

/** Saves any JSON value as a file through a Blob (no server round trip for the download itself). */
function saveJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Download my data" and "Delete my account". Meant to sit inside the Profile page. */
export default function AccountData({ onDeleted }: { onDeleted?: () => void }) {
  const notify = useToast();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const download = async () => {
    setExporting(true); setExportError("");
    try { saveJson(`aivistro-my-data-${isoDay()}.json`, await accountApi.exportData()); notify("Your data has been downloaded"); }
    catch (e) { setExportError(errorText(e, "Couldn't prepare your data. Please try again.")); }
    finally { setExporting(false); }
  };

  return <section className="account-data" aria-label="Your data">
    <div className="ad-card">
      <h3>Download my data</h3>
      <p>Get a copy of everything we hold about you as a single JSON file: profile, sign-in devices, subscriptions, payments, watch history, watchlist and notifications. Passwords and security tokens are never included.</p>
      {exportError && <div className="form-error" role="alert">{exportError}</div>}
      <div><Button className="outline" disabled={exporting} onClick={download}>{exporting ? "Preparing..." : "Download my data"}</Button></div>
    </div>
    <div className="ad-card ad-danger">
      <h3>Delete my account</h3>
      <p>Permanently erases your personal details and viewing data and signs you out everywhere. This cannot be undone.</p>
      <div><Button className="outline danger" onClick={() => setDeleting(true)}>Delete my account</Button></div>
    </div>
    {deleting && <DeleteDialog onClose={() => setDeleting(false)} onDeleted={onDeleted} />}
  </section>;
}

function DeleteDialog({ onClose, onDeleted }: { onClose: () => void; onDeleted?: () => void }) {
  const notify = useToast();
  const { signOut, user } = useApp();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null); // null while we find out
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [lostAccess, setLostAccess] = useState(false);
  const [needsAck, setNeedsAck] = useState(false); // the server said a paid subscription is active
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    accountApi.me().then((m) => { if (live) setHasPassword(!!m.hasPassword); }, () => { if (live) setHasPassword(!!user?.email); }); // fall back to a guess; the server decides anyway
    return () => { live = false; };
  }, [user?.email]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [busy, onClose]);
  useEffect(() => { inputRef.current?.focus(); }, [hasPassword]);

  const ready = typed === "DELETE" && (hasPassword === false || password.length > 0) && hasPassword !== null && (!needsAck || lostAccess);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError("");
    try {
      await accountApi.deleteAccount({ confirm: "DELETE", ...(hasPassword ? { password } : {}), ...(lostAccess ? { acknowledgeLostAccess: true } : {}) });
      notify("Your account has been deleted");
      await signOut();
      onDeleted?.(); // the app takes the person home instead of leaving them on a profile page that no longer exists
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      if (code === "ACTIVE_SUBSCRIPTION") setNeedsAck(true);
      if (code === "PASSWORD_INCORRECT") setPassword("");
      setError(errorText(e, "Couldn't delete your account. Please try again."));
      setBusy(false);
    }
  };

  return <div className="success-modal" role="dialog" aria-modal="true" aria-labelledby="ad-title" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div className="ad-dialog">
      <h2 id="ad-title">Delete your account?</h2>
      <h4>What gets deleted</h4>
      <ul><li>Your name, email, phone number, date of birth and profile picture</li><li>Your watch history, progress, watchlist and notifications</li><li>Linked Google/Apple sign-ins, saved devices and every signed-in session</li></ul>
      <h4>What we keep</h4>
      <ul><li>Payment, refund and subscription records, which we must retain for tax and accounting. They are no longer linked to any personal details.</li></ul>
      <p className="payment-note">You can sign up again with the same email or phone number, but it will be a brand-new account: nothing is restored.</p>
      <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {hasPassword === null ? <p className="payment-note" role="status">Checking your account...</p> : <>
          {hasPassword && <label><span>Your current password</span><input ref={inputRef} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
          <label><span>Type DELETE to confirm</span><input ref={hasPassword ? undefined : inputRef} autoComplete="off" autoCapitalize="characters" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
          {needsAck && <label className="ad-check"><input type="checkbox" checked={lostAccess} onChange={(e) => setLostAccess(e.target.checked)} /><span>I understand my active subscription ends immediately and the remaining time is not refunded automatically.</span></label>}
        </>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="ad-actions">
          <Button className="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" className="outline danger" disabled={!ready || busy}>{busy ? "Deleting..." : "Delete my account"}</Button>
        </div>
      </form>
    </div>
  </div>;
}
