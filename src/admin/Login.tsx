import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { adminAuthApi, type AdminTokens, type LoginStep } from "../api/admin";
import { Button, Credit, Logo, useToast } from "../shared";
import { errorMessage } from "./hooks";
import { useAdminSession } from "./session";

type Stage =
  | { kind: "password" }
  | { kind: "code"; challengeToken: string }
  | { kind: "setup"; setupToken: string; secret: string; qr: string }
  | { kind: "recovery"; tokens: AdminTokens; codes: string[] };

/** Admin sign-in: password, then a mandatory authenticator (TOTP) code. First sign-ins enrol the authenticator. */
export default function AdminLogin() {
  const notify = useToast();
  const { start } = useAdminSession();
  const [stage, setStage] = useState<Stage>({ kind: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { document.title = "AIVISTRO Control Centre"; }, []);
  const run = async (fn: () => Promise<void>) => { if (loading) return; setLoading(true); setError(""); try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); } };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError("Enter your admin email and password.");
    void run(async () => {
      const step: LoginStep = await adminAuthApi.login(email.trim(), password);
      setPassword("");
      if (step.status === "MFA_SETUP_REQUIRED") {
        const { secret, otpauthUri } = await adminAuthApi.enroll(step.setupToken);
        setStage({ kind: "setup", setupToken: step.setupToken, secret, qr: await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 }) });
      } else setStage({ kind: "code", challengeToken: step.challengeToken });
      setCode("");
    });
  };
  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (stage.kind === "code") {
      const v = code.trim();
      if (useRecovery ? v.length < 8 : !/^\d{6}$/.test(v)) return setError(useRecovery ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app.");
      void run(async () => { const t = await adminAuthApi.verify(stage.challengeToken, useRecovery ? { recoveryCode: v } : { code: v }); start(t); notify(`Welcome back, ${t.admin.name}`); });
    } else if (stage.kind === "setup") {
      if (!/^\d{6}$/.test(code.trim())) return setError("Enter the 6-digit code shown in your authenticator app.");
      void run(async () => { const r = await adminAuthApi.confirm(stage.setupToken, code.trim()); setStage({ kind: "recovery", tokens: r, codes: r.recoveryCodes }); });
    }
  };
  const copyCodes = async (codes: string[]) => { try { await navigator.clipboard.writeText(codes.join("\n")); notify("Recovery codes copied"); } catch { notify("Couldn't copy. Select and copy them manually."); } };

  return <div className="admin-login">
    <form className="admin-login-card" onSubmit={stage.kind === "password" ? submitPassword : submitCode} noValidate>
      <Logo admin />
      <span className="eyebrow">RESTRICTED AREA</span>
      {stage.kind === "password" && <>
        <h1 className="heading large">Admin sign in</h1><p>Sign in to manage series, users and subscriptions.</p>
        <div className="auth-form">
          <label><span>Admin email</span><input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} autoComplete="username" /></label>
          <label><span>Password</span><input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} autoComplete="current-password" /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <Button type="submit" className="primary wide" disabled={loading}>{loading ? "Checking..." : "Continue"}</Button>
        </div>
      </>}
      {stage.kind === "code" && <>
        <h1 className="heading large">Two-step verification</h1>
        <p>{useRecovery ? "Enter one of your single-use recovery codes." : "Enter the 6-digit code from your authenticator app."}</p>
        <div className="auth-form">
          <label><span>{useRecovery ? "Recovery code" : "Authenticator code"}</span><input autoFocus inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" value={code} onChange={(e) => { setCode(e.target.value); setError(""); }} placeholder={useRecovery ? "xxxx-xxxx" : "123456"} /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <Button type="submit" className="primary wide" disabled={loading}>{loading ? "Verifying..." : "Verify and sign in"}</Button>
          <button type="button" className="forgot-link" onClick={() => { setUseRecovery(!useRecovery); setCode(""); setError(""); }}>{useRecovery ? "Use my authenticator app" : "Lost your device? Use a recovery code"}</button>
        </div>
      </>}
      {stage.kind === "setup" && <>
        <h1 className="heading large">Set up two-step verification</h1>
        <p>Admin accounts require an authenticator app (Google Authenticator, 1Password, Authy…). Scan this code, then enter the 6-digit code it shows.</p>
        <div className="auth-form">
          <img src={stage.qr} alt="Authenticator setup QR code" width={220} height={220} style={{ borderRadius: 12, background: "#fff", alignSelf: "center" }} />
          <label><span>Can't scan? Enter this key manually</span><input readOnly value={stage.secret} onFocus={(e) => e.currentTarget.select()} /></label>
          <label><span>6-digit code</span><input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => { setCode(e.target.value); setError(""); }} placeholder="123456" /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <Button type="submit" className="primary wide" disabled={loading}>{loading ? "Verifying..." : "Confirm and continue"}</Button>
        </div>
      </>}
      {stage.kind === "recovery" && <>
        <h1 className="heading large">Save your recovery codes</h1>
        <p>If you lose your authenticator, each of these single-use codes lets you sign in once. They are shown <b>only now</b>. Store them somewhere safe.</p>
        <div className="auth-form">
          <pre style={{ margin: 0, padding: 14, borderRadius: 12, background: "rgba(255,255,255,.06)", fontSize: 14, lineHeight: 1.7, userSelect: "all" }}>{stage.codes.join("\n")}</pre>
          <Button type="button" className="outline wide" onClick={() => void copyCodes(stage.codes)}>Copy codes</Button>
          <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ width: 18, height: 18 }} /><span>I have saved these codes</span></label>
          <Button type="button" className="primary wide" disabled={!saved} onClick={() => { start(stage.tokens); notify(`Welcome, ${stage.tokens.admin.name}`); }}>Enter the Control Centre</Button>
        </div>
      </>}
      {stage.kind !== "recovery" && <button type="button" className="auth-switch" onClick={() => (stage.kind === "password" ? window.location.assign(import.meta.env.BASE_URL) : (setStage({ kind: "password" }), setCode(""), setError("")))}>{stage.kind === "password" ? "← Back to AIVISTRO" : "← Start over"}</button>}
      <Credit />
    </form>
  </div>;
}
