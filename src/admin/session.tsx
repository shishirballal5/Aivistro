import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { adminAuthApi, adminClient, type AdminTokens, type AdminView } from "../api/admin";

type Ctx = {
  status: "loading" | "out" | "in"; admin: AdminView | null;
  /** True when the signed-in admin holds the permission. The server enforces this too; this only hides what would be refused. */
  can: (permission: string) => boolean; canAny: (...permissions: string[]) => boolean;
  start: (t: AdminTokens) => void; signOut: () => Promise<void>;
};
const SessionCtx = createContext<Ctx | null>(null);
export const useAdminSession = () => { const c = useContext(SessionCtx); if (!c) throw new Error("useAdminSession outside AdminSessionProvider"); return c; };

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Ctx["status"]>("loading");
  const [admin, setAdmin] = useState<AdminView | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    (async () => {
      if (await adminClient.restore()) { try { const me = await adminAuthApi.me(); if (alive.current) { setAdmin(me); setStatus("in"); } return; } catch { /* fall through to signed out */ } }
      if (alive.current) setStatus("out");
    })();
  }, []);
  useEffect(() => adminClient.onSignedOut(() => { setAdmin(null); setStatus("out"); }), []); // refresh rejected: session over

  const start = useCallback((t: AdminTokens) => { adminClient.setTokens(t); setAdmin(t.admin); setStatus("in"); }, []);
  const signOut = useCallback(async () => { try { await adminAuthApi.logout(); } catch { /* already ended */ } adminClient.clear(); }, []);
  const value = useMemo<Ctx>(() => ({
    status, admin, start, signOut,
    can: (p) => !!admin?.permissions.includes(p),
    canAny: (...ps) => ps.some((p) => !!admin?.permissions.includes(p)),
  }), [status, admin, start, signOut]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
