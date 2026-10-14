import { useState } from "react";
import { Button, useToast } from "../../shared";
import { teamApi, type PermissionRow, type RoleRow } from "../../api/admin-team";
import { useAdminSession } from "../session";
import { errorMessage, useAsync } from "../hooks";
import { Empty, Field, Modal, Panel, Pill } from "../ui";

function PermPicker({ perms, value, onChange }: { perms: PermissionRow[]; value: string[]; onChange: (v: string[]) => void }) {
  return <div className="team-roles">{perms.map((p) => <label key={p.code} className="a-radio"><input type="checkbox" checked={value.includes(p.code)} onChange={(e) => onChange(e.target.checked ? [...value, p.code] : value.filter((x) => x !== p.code))} /> <span><b>{p.code}</b><small>{p.description}</small></span></label>)}</div>;
}

function RoleModal({ role, perms, onClose, onDone }: { role: RoleRow | null; perms: PermissionRow[]; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [sel, setSel] = useState<string[]>(role?.permissions ?? []);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!role && !/^[A-Z][A-Z0-9_]{1,59}$/.test(name)) return setError("Name must be UPPER_SNAKE_CASE, e.g. CONTENT_REVIEWER.");
    setBusy(true); setError("");
    try {
      if (role) await teamApi.setRolePermissions(role.id, sel); else await teamApi.createRole({ name, description: description.trim(), permissions: sel });
      notify(role ? "Permissions updated" : "Role created"); onDone(); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <Modal wide title={role ? `Edit ${role.name}` : "New role"} onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className="primary" disabled={busy} onClick={submit}>{role ? "Save permissions" : "Create role"}</Button></>}>
    <div className="a-form one">
      {!role && <><Field label="Name" hint="UPPER_SNAKE_CASE"><input value={name} maxLength={60} onChange={(e) => { setName(e.target.value.toUpperCase()); setError(""); }} /></Field>
        <Field label="Description"><input value={description} maxLength={255} onChange={(e) => setDescription(e.target.value)} /></Field></>}
      <div><span className="a-muted">Permissions</span><PermPicker perms={perms} value={sel} onChange={setSel} /><small className="a-muted">You can only grant permissions you hold yourself.</small></div>
      {error && <div className="a-error" role="alert">{error}</div>}
    </div>
  </Modal>;
}

export default function SecurityRoles() {
  const { can } = useAdminSession();
  const roles = useAsync(() => teamApi.roles(), []);
  // The permission catalogue needs roles.manage; an admins.manage-only admin sees the roles read-only and no error.
  const perms = useAsync<PermissionRow[]>(() => (can("roles.manage") ? teamApi.permissions() : Promise.resolve([])), []);
  const [modal, setModal] = useState<{ role: RoleRow | null } | null>(null);
  const rows = roles.data ?? [];
  return <Panel flush eyebrow="ACCESS" title="Roles & permissions" action={can("roles.manage") && <Button className="primary" icon="plus" disabled={!perms.data} onClick={() => setModal({ role: null })}>New role</Button>}>
    {roles.loading && !roles.data ? <Empty icon="lock" title="Loading roles..." />
      : roles.error ? <div className="a-pad"><div className="a-error">{roles.error} <Button className="outline" onClick={roles.reload}>Retry</Button></div></div>
      : <ul className="a-list">{rows.map((r) => <li key={r.id}>
        <span className="grow"><b>{r.name}</b><small>{r.description}</small><span className="team-chips">{r.permissions.length ? r.permissions.map((p) => <Pill key={p}>{p}</Pill>) : <small>No permissions</small>}</span></span>
        {r.isSystem ? <Pill tone="violet">System (read-only)</Pill> : <Button className="outline" icon="edit" disabled={!perms.data || !can("roles.manage")} onClick={() => setModal({ role: r })}>Edit</Button>}
      </li>)}</ul>}
    {perms.error && <p className="a-muted a-pad">{perms.error}</p>}
    {modal && perms.data && <RoleModal role={modal.role} perms={perms.data} onClose={() => setModal(null)} onDone={roles.reload} />}
  </Panel>;
}
