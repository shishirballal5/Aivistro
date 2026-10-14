import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { viewerApi } from "../api/http";
import { authApi, billingApi, listApi, publicApi, type AuthResponse, type HomeData, type MySubscription, type PublicConfig, type Tag, type UserView } from "../api/viewer";
import { toShow, type Show } from "./model";

type Status = "loading" | "ready";
type Ctx = {
  status: Status; loadError: string | null; reload: () => void;
  config: PublicConfig | null;
  user: UserView | null; signedIn: boolean; acceptAuth: (r: AuthResponse) => Promise<void>; signOut: () => Promise<void>; setUser: (u: UserView) => void;
  shows: Show[]; genres: Tag[]; home: HomeData | null; showById: (id: string) => Show | undefined;
  subscription: MySubscription | null; active: boolean; refreshSubscription: () => Promise<MySubscription | null>; acceptRefresh: () => Promise<void>;
  saved: Set<string>; toggleSave: (id: string) => Promise<boolean>;
};
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error("useApp outside AppProvider"); return c; };

async function loadAllSeries(): Promise<Show[]> {
  const out: Show[] = []; let cursor: string | undefined;
  for (let i = 0; i < 10; i++) { // up to 500 series; beyond that, switch the UI to server-side search/paging
    const page = await publicApi.series({ limit: 50, cursor, sort: "featured" });
    out.push(...page.items.map(toShow));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [user, setUser] = useState<UserView | null>(null);
  const [shows, setShows] = useState<Show[]>([]);
  const [genres, setGenres] = useState<Tag[]>([]);
  const [home, setHome] = useState<HomeData | null>(null);
  const [subscription, setSubscription] = useState<MySubscription | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // re-arm: StrictMode mounts, unmounts, then mounts again

  const loadUserData = useCallback(async () => {
    const [sub, list] = await Promise.all([billingApi.mine().catch(() => null), listApi.watchlist().catch(() => null)]);
    if (!alive.current) return;
    setSubscription(sub);
    setSaved(new Set((list?.items ?? []).map((s) => s.id)));
  }, []);

  const clearUser = useCallback(() => { setUser(null); setSubscription(null); setSaved(new Set()); }, []);

  const load = useCallback(async () => {
    setStatus("loading"); setLoadError(null);
    try {
      const [cfg, list, gs, hm] = await Promise.all([publicApi.config(), loadAllSeries(), publicApi.genres(), publicApi.home().catch(() => null)]);
      if (!alive.current) return;
      setConfig(cfg); setShows(list); setGenres(gs); setHome(hm);
      if (await viewerApi.restore()) { // a stored refresh token: quietly sign the user back in
        try { const me = await authApi.me(); if (alive.current) { setUser(me); await loadUserData(); } } catch { /* token dead: stay signed out */ }
      }
    } catch (e) { if (alive.current) setLoadError(e instanceof Error ? e.message : "Couldn't load AIVISTRO."); }
    if (alive.current) setStatus("ready");
  }, [loadUserData]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => viewerApi.onSignedOut(clearUser), [clearUser]); // refresh token revoked/reused: drop local state

  const acceptAuth = useCallback(async (r: AuthResponse) => { viewerApi.setTokens(r); setUser(r.user); await loadUserData(); }, [loadUserData]);
  const signOut = useCallback(async () => { try { await authApi.logout(); } catch { /* server may already have ended it */ } viewerApi.clear(); }, []);
  const refreshSubscription = useCallback(async () => { const s = await billingApi.mine().catch(() => null); if (alive.current) setSubscription(s); return s; }, []);

  const toggleSave = useCallback(async (id: string) => {
    const has = saved.has(id);
    setSaved((prev) => { const n = new Set(prev); if (has) n.delete(id); else n.add(id); return n; }); // optimistic
    try { if (has) await listApi.remove(id); else await listApi.add(id); return !has; }
    catch (e) { setSaved((prev) => { const n = new Set(prev); if (has) n.add(id); else n.delete(id); return n; }); throw e; }
  }, [saved]);

  const value = useMemo<Ctx>(() => ({
    status, loadError, reload: () => void load(), config, user, signedIn: !!user, acceptAuth, signOut, setUser, shows, genres, home,
    showById: (id) => shows.find((s) => s.id === id), subscription, active: !!subscription?.active, refreshSubscription, acceptRefresh: async () => { await refreshSubscription(); }, saved, toggleSave,
  }), [status, loadError, load, config, user, acceptAuth, signOut, shows, genres, home, subscription, refreshSubscription, saved, toggleSave]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
