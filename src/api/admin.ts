import { createClient } from "./http";

/** One client for the whole admin portal. Its tokens are separate from the viewer's (different storage key and refresh endpoint). */
export const adminClient = createClient("admin", "/admin/auth/refresh");
export const adminRequest = adminClient.request;

export type AdminView = { id: string; email: string; name: string; roles: string[]; permissions: string[] };
export type AdminTokens = { accessToken: string; refreshToken: string; tokenType: "Bearer"; expiresIn: number; admin: AdminView };
export type LoginStep = { status: "MFA_REQUIRED"; challengeToken: string } | { status: "MFA_SETUP_REQUIRED"; setupToken: string };

export const adminAuthApi = {
  login: (email: string, password: string) => adminRequest<LoginStep>("/admin/auth/login", { method: "POST", body: { email, password }, auth: "none" }),
  enroll: (setupToken: string) => adminRequest<{ secret: string; otpauthUri: string }>("/admin/auth/mfa/enroll", { method: "POST", body: { setupToken }, auth: "none" }),
  confirm: (setupToken: string, code: string) => adminRequest<AdminTokens & { recoveryCodes: string[] }>("/admin/auth/mfa/confirm", { method: "POST", body: { setupToken, code }, auth: "none" }),
  verify: (challengeToken: string, input: { code?: string; recoveryCode?: string }) => adminRequest<AdminTokens>("/admin/auth/mfa/verify", { method: "POST", body: { challengeToken, ...input }, auth: "none" }),
  me: () => adminRequest<AdminView>("/admin/auth/me"),
  logout: () => adminRequest<void>("/admin/auth/logout", { method: "POST" }),
  logoutAll: () => adminRequest<void>("/admin/auth/logout-all", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) => adminRequest<void>("/admin/auth/password/change", { method: "POST", body: { currentPassword, newPassword } }),
};
