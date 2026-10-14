import { useState } from "react";
import { Button, useToast } from "../../shared";
import { teamApi, type AdminUserRow, type RoleRow } from "../../api/admin-team";
import { useAdminSession } from "../session";
import { errorMessage, useAsync } from "../hooks";
import { Avatar, Confirm, Empty, Field, Modal, Panel, Pill, RowMenu, fmtDateTime, type ConfirmState } from "../ui";

function RolePicker({ roles, value, onChange }: { roles: RoleRow[]; value: string[]; onChange: (v: string[]) => void }) {
  return <div className="team-roles">{roles.map((r) => <label key={r.id} className="a-radio"><input type="checkbox" checked={value.includes(r.id)} onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))} /> <span><b>{r.name}</b><small>{r.description}</small></span></label>)}</div>;
}

function CreateModal({ roles, onClose, onDone }: { roles: RoleRow[]; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [password, setPassword] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return setError("Enter their name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email.");
    if (password.length < 10) return setError("The initial password must be at least 10 characters.");
    setBusy(true); setError("");
    try { await teamApi.createAdmin({ email: email.trim(), name: name.trim(), password, roleIds }); notify("Admin created. They set up two-factor sign-in at their first login."); onDone(); onClose(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Modal title="Add team member" onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy} onClick={submit}>Create admin</Button></>}>
    <div className="a-form one">
      <Field label="Full name"><input autoFocus value={name} maxLength={100} onChange={(e) => { setName(e.target.value); setError(""); }} /></Field>
      <Field label="Work email"><input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} /></Field>
      <Field label="Initial password" hint="10 to 128 characters. Share it securely; they must enrol an authenticator app at first sign-in."><input type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} /></Field>
      <div><span className="a-muted">Roles</span><RolePicker roles={roles} value={roleIds} onChange={setRoleIds} /><small className="a-muted">You can only grant roles whose permissions you hold yourself.</small></div>
      {error && <div className="a-error" role="alert">{error}</div>}
    </div>
  </Modal>;
}

function EditModal({ admin, roles, self, onClose, onDone }: { admin: AdminUserRow; roles: RoleRow[]; self: boolean; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const [name, setName] = useState(admin.name); const [roleIds, setRoleIds] = useState(admin.roles.map((r) => r.id));
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return setError("Enter a name.");
    setBusy(true); setError("");
    const body: { name?: string; roleIds?: string[] } = {};
    if (name.trim() !== admin.name) body.name = name.trim();
    if (!self && [...roleIds].sort().join() !== admin.roles.map((r) => r.id).sort().join()) body.roleIds = roleIds;
    try { if (Object.keys(body).length) await teamApi.updateAdmin(admin.id, body); notify(body.roleIds ? "Saved. Their sessions were ended so new roles apply." : "Saved"); onDone(); onClose(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Modal title={`Edit ${admin.name}`} onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy} onClick={submit}>Save</Button></>}>
    <div className="a-form one">
      <Field label="Name"><input value={name} maxLength={100} onChange={(e) => { setName(e.target.value); setError(""); }} /></Field>
      <div><span className="a-muted">Roles</span>{self ? <p className="a-muted">You can't change your own roles.</p> : <RolePicker roles={roles} value={roleIds} onChange={setRoleIds} />}</div>
      {error && <div className="a-error" role="alert">{error}</div>}
    </div>
  </Modal>;
}

export default function TeamAdmins() {
  const { admin: me } = useAdminSession();
  const notify = useToast();
  const admins = useAsync(() => teamApi.admins(), []);
  const roles = useAsync(() => teamApi.roles(), []);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<AdminUserRow | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const run = async (p: Promise<unknown>, ok: string) => { try { await p; notify(ok); } catch (e) { notify(errorMessage(e)); } admins.reload(); };
  const rows = admins.data ?? [];

  return <Panel flush eyebrow="ACCESS" title="Team members" action={<Button className="primary" icon="plus" disabled={!roles.data} onClick={() => setCreating(true)}>Add member</Button>}>
    {admins.loading && !admins.data ? <Empty icon="users" title="Loading team..." />
      : admins.error ? <div className="a-pad"><div className="a-error">{admins.error} <Button className="outline" onClick={admins.reload}>Retry</Button></div></div>
      : rows.length ? <ul className="a-list">{rows.map((a) => { const self = a.id === me?.id; return <li key={a.id}>
        <Avatar name={a.name} />
        <span className="grow"><b>{a.name}{self && <small className="a-you"> (you)</small>}</b><small>{a.email}</small><small>{a.roles.map((r) => r.name).join(", ") || "No roles"} · {a.lastLoginAt ? `Last sign-in ${fmtDateTime(a.lastLoginAt)}` : "Never signed in"}</small></span>
        <Pill tone={a.mfaEnabled ? "green" : "amber"}>{a.mfaEnabled ? "MFA on" : "MFA pending"}</Pill>
        <Pill tone={a.status === "ACTIVE" ? "green" : "red"}>{a.status === "ACTIVE" ? "Active" : "Disabled"}</Pill>
        <RowMenu label={`Actions for ${a.name}`} items={[
          { label: "Edit name and roles", icon: "edit", onClick: () => setEdit(a) },
          ...(self ? [] : [
            a.status === "ACTIVE"
              ? { label: "Disable", icon: "lock" as const, danger: true, onClick: () => setConfirm({ title: `Disable ${a.name}?`, text: "They will be signed out immediately and can't sign in until re-enabled.", label: "Disable", danger: true, onConfirm: () => run(teamApi.updateAdmin(a.id, { status: "DISABLED" }), "Disabled") }) }
              : { label: "Enable", icon: "check" as const, onClick: () => run(teamApi.updateAdmin(a.id, { status: "ACTIVE" }), "Enabled") },
            { label: "Reset MFA", icon: "trash" as const, danger: true, onClick: () => setConfirm({ title: `Reset MFA for ${a.name}?`, text: "Their authenticator and recovery codes are removed and all their sessions end. They must enrol a new authenticator at their next sign-in.", label: "Reset MFA", danger: true, onConfirm: () => run(teamApi.resetMfa(a.id), "MFA reset. They'll re-enrol at next sign-in.") }) },
          ]),
        ]} />
      </li>; })}</ul> : <Empty icon="users" title="No team members" />}
    {creating && roles.data && <CreateModal roles={roles.data} onClose={() => setCreating(false)} onDone={admins.reload} />}
    {edit && roles.data && <EditModal admin={edit} roles={roles.data} self={edit.id === me?.id} onClose={() => setEdit(null)} onDone={admins.reload} />}
    <Confirm state={confirm} onClose={() => setConfirm(null)} />
  </Panel>;
}
