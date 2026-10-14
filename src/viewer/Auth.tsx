import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { ApiError } from "../api/http";
import { authApi, publicApi, type AuthResponse, type NewProfile } from "../api/viewer";
import { Button, Credit, Icon, Logo, useToast } from "../shared";
import { dateOfBirthProblem, errorText, latestAllowedBirthDate, MIN_AGE_YEARS } from "./model";
import { useApp } from "./store";

export type AuthMode = "welcome" | "signup" | "signin" | "otp" | "forgot" | "reset" | "verify" | "details";
export type AuthPending = { name: string; phone: string; email: string; token: string; dateOfBirth: string; profileToken: string };
export const emptyPending: AuthPending = { name: "", phone: "", email: "", token: "", dateOfBirth: "", profileToken: "" };

const digitsOf = (s: string) => s.replace(/\D/g, "");
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const passwordProblem = (s: string) => (s.length < 10 ? "Use at least 10 characters." : /^\d+$/.test(s) ? "Choose a password that isn't only digits." : "");
const toE164 = (tenDigits: string) => `+91${tenDigits}`;

/** Development only: when the server uses the dev SMS/email adapters it exposes what it "sent", so you can finish the flow locally. */
function useDevMessage(to: string, enabled: boolean, nonce: number) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !to) { setMessage(null); return; }
    let live = true;
    publicApi.devOutbox(to).then((r) => { if (live) setMessage(r.message?.body ?? null); }).catch(() => undefined);
    return () => { live = false; };
  }, [to, enabled, nonce]);
  return message;
}

/** Google Identity Services. Only used when the server reports a Google client id; the ID token is verified server-side. */
function GoogleButton({ clientId, onToken }: { clientId: string; onToken: (t: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = window as unknown as { google?: { accounts: { id: { initialize(o: object): void; renderButton(el: HTMLElement, o: object): void } } } };
    const init = () => { if (!w.google || !box.current) return; w.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => onToken(r.credential) }); w.google.accounts.id.renderButton(box.current, { theme: "outline", size: "large", width: 240 }); };
    if (w.google) { init(); return; }
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = init; document.head.appendChild(s);
  }, [clientId, onToken]);
  return <div className="social-buttons"><div ref={box} /></div>;
}

export function AuthSlides({ images }: { images: { id: string; title: string; image: string; genre: string; episodes: number }[] }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (images.length < 2) return; const t = window.setInterval(() => setI((n) => (n + 1) % images.length), 4500); return () => window.clearInterval(t); }, [images.length]);
  if (!images.length) return null;
  const cur = images[i % images.length];
  return <>
    <div className="auth-slides" aria-hidden="true">{images.map((s, n) => <img key={s.id} className={n === i ? "on" : ""} src={s.image} alt="" />)}</div>
    <div className="auth-caption" key={cur.id}><small>NOW STREAMING</small><b>{cur.title}</b><span>{cur.genre} · {cur.episodes} episodes</span></div>
  </>;
}

export default function AuthScreen({ mode, go, startAuth, pending, setPending, onAuthenticated }: { mode: AuthMode; go: (m: string) => void; startAuth: (m: string) => void; pending: AuthPending; setPending: (p: AuthPending) => void; onAuthenticated: () => void }) {
  const notify = useToast();
  const { config, shows, acceptAuth } = useApp();
  const dev = config?.development.devMessages ?? false;
  const phoneOn = config?.auth.phoneOtp ?? true;
  const emailOn = config?.auth.emailPassword ?? true;
  const [method, setMethod] = useState<"phone" | "email">(phoneOn || !emailOn ? "phone" : "email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState({ name: pending.name, phone: pending.phone, email: pending.email, password: "", confirm: "", identifier: pending.email, token: pending.token, dateOfBirth: pending.dateOfBirth });
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [seconds, setSeconds] = useState(30);
  const [nonce, setNonce] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // re-arm: StrictMode mounts, unmounts, then mounts again
  useEffect(() => {
    if (mode !== "otp" || seconds <= 0) return;
    const t = window.setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [mode, seconds]);

  const devTarget = mode === "otp" ? toE164(pending.phone) : mode === "verify" || mode === "reset" ? pending.email : "";
  const devBody = useDevMessage(devTarget, dev && (mode === "otp" || mode === "verify" || mode === "reset"), nonce);
  const devCode = devBody?.match(/\b\d{6}\b/)?.[0];
  const devToken = devBody?.match(/token=([\w-]+)/)?.[1];

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => { const v = e.target.value; setF((p) => ({ ...p, [k]: v })); setError(""); };
  const fail = (m: string) => setError(m);
  /** Runs an API call with a loading state; shows the server's message on failure. */
  const run = async (fn: () => Promise<void>) => {
    if (loading) return;
    setLoading(true); setError("");
    try { await fn(); } catch (e) { if (alive.current) setError(errorText(e, "Something went wrong. Please try again.")); }
    finally { if (alive.current) setLoading(false); }
  };
  const finish = async (r: AuthResponse) => {
    await acceptAuth(r);
    setPending(emptyPending);
    onAuthenticated();
  };
  const profileOf = (): NewProfile => ({ displayName: f.name.trim(), email: f.email.trim().toLowerCase(), dateOfBirth: f.dateOfBirth });
  /** Same checks the server makes, for instant feedback. The server is the authority. */
  const profileProblem = () => (f.name.trim().length < 2 ? "Enter your full name." : !isEmail(f.email) ? "Enter a valid email address." : dateOfBirthProblem(f.dateOfBirth));

  const sendOtp = (withProfile: boolean) => run(async () => {
    await authApi.requestOtp(toE164(digitsOf(f.phone)));
    setPending({ ...pending, name: withProfile ? f.name.trim() : "", email: withProfile ? f.email.trim().toLowerCase() : "", dateOfBirth: withProfile ? f.dateOfBirth : "", phone: digitsOf(f.phone), profileToken: "" });
    setSeconds(30); setOtp(["", "", "", "", "", ""]); setNonce((n) => n + 1);
    go("otp");
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "signup") {
      const prob = profileProblem(); if (prob) return fail(prob);
      if (method === "phone") { if (digitsOf(f.phone).length !== 10) return fail("Enter a valid 10-digit mobile number."); return void sendOtp(true); }
      const pw = passwordProblem(f.password); if (pw) return fail(pw);
      return void run(async () => { await authApi.register(f.email.trim(), f.password, f.name.trim(), f.dateOfBirth); setPending({ ...pending, name: f.name.trim(), email: f.email.trim().toLowerCase(), token: "" }); setNonce((n) => n + 1); go("verify"); });
    }
    if (mode === "signin") {
      if (method === "phone") { if (digitsOf(f.phone).length !== 10) return fail("Enter a valid 10-digit mobile number."); return void sendOtp(false); }
      if (!isEmail(f.email)) return fail("Enter a valid email address.");
      if (!f.password) return fail("Enter your password.");
      return void run(async () => {
        try { await finish(await authApi.login(f.email.trim(), f.password)); }
        catch (e) { if (e instanceof ApiError && e.code === "EMAIL_NOT_VERIFIED") { setPending({ ...pending, email: f.email.trim().toLowerCase() }); notify("Please verify your email first."); go("verify"); return; } throw e; }
      });
    }
    if (mode === "otp") {
      const code = otp.join("");
      if (code.length !== 6) return fail("Enter the complete 6-digit verification code.");
      return void run(async () => {
        const profile = pending.name && pending.email && pending.dateOfBirth ? { displayName: pending.name, email: pending.email, dateOfBirth: pending.dateOfBirth } : undefined;
        const res = await authApi.verifyOtp(toE164(pending.phone), code, profile);
        if ("status" in res) { setPending({ ...pending, profileToken: res.profileToken }); notify("One last step: tell us about yourself."); go("details"); return; } // a new number that signed in without details
        await finish(res);
      });
    }
    if (mode === "verify") {
      if (f.token.trim().length < 20) return fail("Paste the verification code from your email.");
      return void run(async () => { await authApi.verifyEmail(f.token.trim().replace(/^.*token=/, "")); notify("Email verified. Please sign in."); go("signin"); });
    }
    if (mode === "details") {
      const prob = profileProblem(); if (prob) return fail(prob);
      return void run(async () => { await finish(await authApi.completeProfile(pending.profileToken, profileOf())); });
    }
    if (mode === "forgot") {
      if (!isEmail(f.identifier)) return fail("Enter the email address you registered with.");
      return void run(async () => { await authApi.forgotPassword(f.identifier.trim()); setPending({ ...pending, email: f.identifier.trim().toLowerCase() }); setNonce((n) => n + 1); go("reset"); });
    }
    if (mode === "reset") {
      if (f.token.trim().length < 20) return fail("Paste the reset code from your email.");
      const pw = passwordProblem(f.password); if (pw) return fail(pw);
      if (f.password !== f.confirm) return fail("Passwords don’t match.");
      return void run(async () => { await authApi.resetPassword(f.token.trim().replace(/^.*token=/, ""), f.password); notify("Password updated. Please sign in."); go("signin"); });
    }
  };

  const changeOtp = (i: number, value: string) => { const d = value.replace(/\D/g, "").slice(-1); setOtp((o) => o.map((x, j) => (j === i ? d : x))); setError(""); if (d && i < 5) otpRefs.current[i + 1]?.focus(); };
  const keyOtp = (i: number, e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Backspace" && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus(); };
  const pasteOtp = (e: ClipboardEvent<HTMLInputElement>) => { const d = digitsOf(e.clipboardData.getData("text")).slice(0, 6); if (!d) return; e.preventDefault(); setOtp(Array.from({ length: 6 }, (_, i) => d[i] ?? "")); otpRefs.current[Math.min(d.length, 5)]?.focus(); };
  const resend = () => run(async () => { await authApi.requestOtp(toE164(pending.phone)); setSeconds(30); setNonce((n) => n + 1); notify("A new code is on its way"); });
  const resendEmail = () => run(async () => { await authApi.resendVerification(pending.email); setNonce((n) => n + 1); notify("If the address is registered, a new email is on its way."); });
  const googleToken = (idToken: string) => void run(async () => { await finish(await authApi.google(idToken, f.dateOfBirth || undefined)); });

  const masked = pending.phone ? `+91 ••••• ${pending.phone.slice(-5)}` : "your mobile number";
  const label = (idle: string, busy: string) => (loading ? busy : idle);
  const slides = shows.filter((s, i, all) => all.findIndex((x) => x.image === s.image) === i).slice(0, 8);
  const social = config?.auth.google ? <><div className="or"><span />or continue with<span /></div><GoogleButton clientId={config.auth.google.clientId} onToken={googleToken} /></> : null;
  const tabs = phoneOn && emailOn ? <div className="auth-tabs" role="tablist"><button type="button" role="tab" aria-selected={method === "phone"} className={method === "phone" ? "active" : ""} onClick={() => { setMethod("phone"); setError(""); }}>Mobile + OTP</button><button type="button" role="tab" aria-selected={method === "email"} className={method === "email" ? "active" : ""} onClick={() => { setMethod("email"); setError(""); }}>Email</button></div> : null;
  const phoneField = <label><span>Mobile number</span><div className="phone-input"><b>+91</b><input value={f.phone} onChange={set("phone")} inputMode="tel" placeholder="98765 43210" autoComplete="tel-national" /></div></label>;
  const dobField = <label><span>Date of birth</span><input type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} max={latestAllowedBirthDate()} min="1900-01-01" autoComplete="bday" /><small>You must be at least {MIN_AGE_YEARS} years old.</small></label>;
  const errorBox = error && <div className="form-error" role="alert">{error}</div>;
  const devBox = (text: string, action?: () => void) => dev && devBody ? <div className="payment-note" role="note"><b>Development only:</b> {text}{action && <> <button type="button" className="forgot-link" onClick={action}>Use it</button></>}</div> : null;

  if (mode === "welcome") return <div className="auth-shell welcome-screen">
    <div className="auth-art"><AuthSlides images={slides} /><i /></div>
    <div className="welcome-copy"><img className="brand-art" src={`${import.meta.env.BASE_URL}logo.jpg`} alt="AIVISTRO — Stories. Reimagined." /><h1 className="display-title small">Your next obsession<br /><em>starts here.</em></h1><p>Discover captivating short dramas and unforgettable stories, made for every stolen moment. One membership unlocks every episode.</p><Button className="primary wide" onClick={() => startAuth("signup")}>Get Started</Button><Button className="outline wide" onClick={() => startAuth("signin")}>I already have an account</Button><button type="button" className="browse-guest" onClick={() => go("home")}>Browse as guest</button><Credit className="auth-credit" /></div>
  </div>;

  return <div className="auth-shell">
    <div className="auth-art compact"><AuthSlides images={slides} /><i /><span><Logo /><h2 className="heading large">Short stories.<br />Long afterglow.</h2><p>A new world of drama, always a few minutes away.</p></span></div>
    <button type="button" className="auth-back" onClick={() => go(mode === "signin" || mode === "signup" ? "welcome" : "signin")}><Icon name="back" /> Back</button>
    <div className="auth-panel"><Logo />
      <form onSubmit={submit} noValidate>
        {mode === "signup" && <><span className="eyebrow">JOIN AIVISTRO</span><h1 className="heading large">Create your account</h1><p>Start building your watchlist. Subscribe when you’re ready to unlock every episode.</p>{tabs}<div className="auth-form"><label><span>Full name</span><input value={f.name} onChange={set("name")} placeholder="Your name" autoComplete="name" /></label><label><span>Email address</span><input value={f.email} onChange={set("email")} type="email" placeholder="you@example.com" autoComplete="email" /></label>{dobField}{method === "phone" ? phoneField : <><label><span>Password</span><input value={f.password} onChange={set("password")} type="password" placeholder="At least 10 characters" autoComplete="new-password" /><small>Use 10+ characters. Avoid common passwords.</small></label></>}{errorBox}<Button type="submit" className="primary wide" disabled={loading}>{label(method === "phone" ? "Send OTP" : "Create Account", "Please wait...")}</Button>{social}<small className="legal-copy">By creating an account, you agree to our <a href="/legal/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a> and <a href="/legal/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</small></div><button type="button" className="auth-switch" onClick={() => go("signin")}>Already have an account? <b>Sign In</b></button></>}
        {mode === "signin" && <><span className="eyebrow">WELCOME BACK</span><h1 className="heading large">Sign in to continue</h1><p>Your saved stories and membership are waiting.</p>{tabs}<div className="auth-form">{method === "phone" ? phoneField : <><label><span>Email address</span><input value={f.email} onChange={set("email")} type="email" placeholder="you@example.com" autoComplete="email" /></label><label><span>Password</span><input value={f.password} onChange={set("password")} type="password" placeholder="Your password" autoComplete="current-password" /></label><button type="button" className="forgot-link" onClick={() => go("forgot")}>Forgot password?</button></>}{errorBox}<Button type="submit" className="primary wide" disabled={loading}>{label(method === "phone" ? "Send OTP" : "Sign In", "Please wait...")}</Button>{social}</div><button type="button" className="auth-switch" onClick={() => go("signup")}>New to AIVISTRO? <b>Create an account</b></button></>}
        {mode === "otp" && <><span className="eyebrow">SECURE VERIFICATION</span><h1 className="heading large">Verify it’s you</h1><p>Enter the six-digit code sent to {masked}.</p>{devCode && devBox(`the code the server “sent” is ${devCode}.`, () => setOtp(devCode.split("")))}<div className="otp-row">{otp.map((digit, index) => <input key={index} ref={(el) => { otpRefs.current[index] = el; }} aria-label={`OTP digit ${index + 1}`} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={1} value={digit} onChange={(e) => changeOtp(index, e.target.value)} onKeyDown={(e) => keyOtp(index, e)} onPaste={pasteOtp} />)}</div>{errorBox}<Button type="submit" className="primary wide" disabled={loading}>{label("Verify & Continue", "Verifying...")}</Button><div className="otp-actions"><button type="button" onClick={() => go("signin")}>Edit number</button>{seconds > 0 ? <span>Resend in 00:{String(seconds).padStart(2, "0")}</span> : <button type="button" onClick={resend}>Resend code</button>}</div></>}
        {mode === "verify" && <><span className="eyebrow">ONE LAST STEP</span><h1 className="heading large">Check your email</h1><p>We sent a verification link to <b>{pending.email || "your email"}</b>. Open it, or paste the code from the link below.</p>{devToken && devBox("the server captured the email.", () => setF((p) => ({ ...p, token: devToken })))}<div className="auth-form"><label><span>Verification code</span><input value={f.token} onChange={set("token")} placeholder="Paste the code or the whole link" autoComplete="off" /></label>{errorBox}<Button type="submit" className="primary wide" disabled={loading}>{label("Verify email", "Verifying...")}</Button><button type="button" className="forgot-link" onClick={resendEmail}>Resend email</button></div></>}
        {mode === "details" && <><span className="eyebrow">ALMOST THERE</span><h1 className="heading large">Tell us about you</h1><p>Your number is verified. We just need a few details to create your account.</p><div className="auth-form"><label><span>Full name</span><input autoFocus value={f.name} onChange={set("name")} placeholder="Your name" autoComplete="name" /></label><label><span>Email address</span><input value={f.email} onChange={set("email")} type="email" placeholder="you@example.com" autoComplete="email" /></label>{dobField}{errorBox}<Button type="submit" className="primary wide" disabled={loading}>{label("Create my account", "Creating account...")}</Button></div></>}
        {mode === "forgot" && <><span className="eyebrow">ACCOUNT RECOVERY</span><h1 className="heading large">Forgot your password?</h1><p>Enter your email and we’ll send a secure reset link.</p><div className="auth-form"><label><span>Email address</span><input value={f.identifier} onChange={set("identifier")} type="email" placeholder="you@example.com" /></label>{errorBox}<Button type="submit" className="primary wide" disabled={loading}>{label("Send reset link", "Sending...")}</Button></div></>}
        {mode === "reset" && <><span className="eyebrow">CREATE A NEW PASSWORD</span><h1 className="heading large">Reset password</h1><p>Paste the code from the email, then choose a new password.</p>{devToken && devBox("the server captured the reset email.", () => setF((p) => ({ ...p, token: devToken })))}<div className="auth-form"><label><span>Reset code</span><input value={f.token} onChange={set("token")} placeholder="Paste the code or the whole link" autoComplete="off" /></label><label><span>New password</span><input value={f.password} onChange={set("password")} type="password" placeholder="At least 10 characters" autoComplete="new-password" /></label><label><span>Confirm password</span><input value={f.confirm} onChange={set("confirm")} type="password" placeholder="Enter it again" autoComplete="new-password" /></label>{errorBox}<Button type="submit" className="primary wide" disabled={loading}>{label("Reset Password", "Updating password...")}</Button></div></>}
      </form>
      <Credit className="auth-credit" />
    </div>
  </div>;
}
