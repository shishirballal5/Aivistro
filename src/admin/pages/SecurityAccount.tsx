import { useState } from "react";
import { Button, useToast } from "../../shared";
import { adminAuthApi } from "../../api/admin";
import { useAdminSession } from "../session";
import { errorMessage } from "../hooks";
import { Avatar, Confirm, Field, Panel, Pill, type ConfirmState } from "../ui";

export default function SecurityAccount() {
  const { admin, signOut } = useAdminSession();
  const notify = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  if (!admin) return null;

  const change = async () => {
    if (!cur) return setError("Enter your current password.");
    if (next.length < 10) return setError("The new password must be at least 10 characters.");
    if (next !== again) return setError("The new passwords don't match.");
    setBusy(true); setError("");
    try {
      await adminAuthApi.changePassword(cur, next);
      notify("Password changed. Other devices were signed out.");
      setCur(""); setNext(""); setAgain("");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const signOutAll = () => setConfirm({
    title: "Sign out of all devices?", text: "Every session of your account, including this one, will end and you'll sign in again.", label: "Sign out everywhere", danger: true,
    onConfirm: async () => { try { await adminAuthApi.logoutAll(); } catch (e) { notify(errorMessage(e)); return; } await signOut(); },
  });

  return <>
    <Panel eyebrow="MY ACCOUNT" title="Profile">
      <div className="a-profile"><Avatar name={admin.name} size={48} /><span><b>{admin.name}</b><small>{admin.email}</small></span></div>
      <p className="a-muted">Roles</p>
      <div className="team-chips">{admin.roles.length ? admin.roles.map((r) => <Pill key={r} tone="violet">{r}</Pill>) : <span className="a-muted">None</span>}</div>
      <p className="a-muted">Permissions</p>
      <div className="team-chips">{admin.permissions.length ? [...admin.permissions].sort().map((p) => <Pill key={p}>{p}</Pill>) : <span className="a-muted">None</span>}</div>
      <p className="a-muted">Two-factor authentication is required for every admin. Only another administrator with team access can reset it for you.</p>
    </Panel>
    <Panel eyebrow="SECURITY" title="Change password">
      <div className="a-form one">
        <Field label="Current password"><input type="password" autoComplete="current-password" value={cur} onChange={(e) => { setCur(e.target.value); setError(""); }} /></Field>
        <Field label="New password" hint="At least 10 characters. Avoid common or all-numeric passwords."><input type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setError(""); }} /></Field>
        <Field label="Repeat new password"><input type="password" autoComplete="new-password" value={again} onChange={(e) => { setAgain(e.target.value); setError(""); }} /></Field>
        <p className="a-muted">After a successful change the server signs you out of all your other devices; this session stays active.</p>
        {error && <div className="a-error" role="alert">{error}</div>}
        <div><Button className="primary" disabled={busy} onClick={change}>{busy ? "Changing..." : "Change password"}</Button></div>
      </div>
    </Panel>
    <Panel eyebrow="SESSIONS" title="Sign out everywhere">
      <p className="a-muted">Ends every signed-in session of your account on all browsers and devices, including this one.</p>
      <Button className="a-danger" onClick={signOutAll}>Sign out of all devices</Button>
    </Panel>
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </>;
}
