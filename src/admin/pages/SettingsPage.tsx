import { useState } from "react";
import { useAdminSession } from "../session";
import { teamApi } from "../../api/admin-team";
import { useAsync } from "../hooks";
import { PageHead } from "../ui";
import SecurityAccount from "./SecurityAccount";
import TeamAdmins from "./TeamAdmins";
import SecurityRoles from "./SecurityRoles";
import AuditLogPanel from "./AuditLogPanel";
import "./SettingsPage.css";

type Tab = "account" | "team" | "roles" | "audit";

export default function SettingsPage() {
  const { can } = useAdminSession();
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: "account", label: "My account", show: true },
    { key: "team", label: "Team", show: can("admins.manage") },
    { key: "roles", label: "Roles", show: can("roles.manage") || can("admins.manage") },
    { key: "audit", label: "Audit log", show: can("audit.read") },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>("account");
  const cur = visible.some((t) => t.key === tab) ? tab : "account";
  // Resolve admin ids to names in the audit log, when allowed.
  const names = useAsync(async () => (can("admins.manage") ? Object.fromEntries((await teamApi.admins()).map((a) => [a.id, a.name])) : {}), [can("admins.manage")]);

  return <div className="a-page">
    <PageHead eyebrow="WORKSPACE" title="Team & security" sub="Your account, team access, roles and the audit trail." />
    <div className="a-tabs wide" role="tablist">{visible.map((t) => <button type="button" role="tab" aria-selected={cur === t.key} key={t.key} className={cur === t.key ? "active" : ""} onClick={() => setTab(t.key)}>{t.label}</button>)}</div>
    {cur === "account" && <SecurityAccount />}
    {cur === "team" && <TeamAdmins />}
    {cur === "roles" && <SecurityRoles />}
    {cur === "audit" && <AuditLogPanel names={(names.data as Record<string, string>) ?? {}} />}
  </div>;
}
