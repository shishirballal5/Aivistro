import { adminRequest } from "./admin";

/* ── Notification campaigns (/admin/notifications) ── */
export type Audience = "ALL" | "SUBSCRIBERS" | "NON_SUBSCRIBERS";
export type NoticeCategory = "MARKETING" | "NEW_EPISODES" | "BILLING";
export type CampaignStatus = "DRAFT" | "SCHEDULED" | "SENDING" | "SENT" | "CANCELLED";
export type Campaign = {
  id: string; title: string; body: string; audience: Audience; category: NoticeCategory; status: CampaignStatus;
  data: Record<string, string> | null; scheduledAt: string | null; sentAt: string | null; recipientCount: number; createdAt: string;
};
export type CampaignInput = { title: string; body: string; audience: Audience; category?: NoticeCategory; scheduledAt?: string; data?: Record<string, string> };

export const campaignsApi = {
  list: () => adminRequest<Campaign[]>("/admin/notifications"),
  get: (id: string) => adminRequest<Campaign>(`/admin/notifications/${id}`),
  create: (b: CampaignInput) => adminRequest<Campaign>("/admin/notifications", { method: "POST", body: b }),
  send: (id: string) => adminRequest<Campaign>(`/admin/notifications/${id}/send`, { method: "POST" }),
  cancel: (id: string) => adminRequest<Campaign>(`/admin/notifications/${id}/cancel`, { method: "POST" }),
};

/* ── Team, roles, audit (/admin/...) ── */
export type AdminUserRow = { id: string; email: string; name: string; status: "ACTIVE" | "DISABLED"; mfaEnabled: boolean; lastLoginAt: string | null; createdAt: string; roles: { id: string; name: string }[] };
export type RoleRow = { id: string; name: string; description: string; isSystem: boolean; permissions: string[] };
export type PermissionRow = { code: string; description: string };
export type AuditRow = { id: string; actorType: "ADMIN" | "USER" | "SYSTEM"; actorId: string | null; action: string; entityType: string | null; entityId: string | null; metadata: Record<string, unknown> | null; ipAddress: string | null; requestId: string | null; createdAt: string };
export type AuditQuery = { action?: string; entityType?: string; entityId?: string; actorType?: string; actorId?: string; from?: string; to?: string; cursor?: string | null; limit?: number };

export const teamApi = {
  admins: () => adminRequest<AdminUserRow[]>("/admin/admin-users"),
  createAdmin: (b: { email: string; name: string; password: string; roleIds: string[] }) => adminRequest<AdminUserRow>("/admin/admin-users", { method: "POST", body: b }),
  updateAdmin: (id: string, b: { name?: string; status?: "ACTIVE" | "DISABLED"; roleIds?: string[] }) => adminRequest<AdminUserRow>(`/admin/admin-users/${id}`, { method: "PATCH", body: b }),
  resetMfa: (id: string) => adminRequest<{ id: string; mfaEnabled: boolean }>(`/admin/admin-users/${id}/reset-mfa`, { method: "POST" }),
  roles: () => adminRequest<RoleRow[]>("/admin/roles"),
  permissions: () => adminRequest<PermissionRow[]>("/admin/permissions"),
  createRole: (b: { name: string; description: string; permissions: string[] }) => adminRequest<RoleRow>("/admin/roles", { method: "POST", body: b }),
  setRolePermissions: (id: string, permissions: string[]) => adminRequest<RoleRow>(`/admin/roles/${id}/permissions`, { method: "PUT", body: { permissions } }),
  audit: (q: AuditQuery) => adminRequest<{ items: AuditRow[]; nextCursor: string | null }>("/admin/audit-logs", { query: { ...q } }),
};
