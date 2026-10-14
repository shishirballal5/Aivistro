/* Small fetch client for the AIVISTRO backend (/api/v1). One instance per realm (viewer, admin):
   - the access token lives in memory only; the rotating refresh token lives in localStorage (so a reload keeps you signed in);
   - a 401 triggers exactly one refresh + retry; refreshes are serialised (in this tab and, via Web Locks, across tabs)
     because the server treats a re-used refresh token as theft and revokes the whole session. */

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public requestId?: string) { super(message); }
}

export type Tokens = { accessToken: string; refreshToken: string };
type Options = { method?: string; body?: unknown; auth?: "required" | "optional" | "none"; query?: Record<string, string | number | undefined | null>; signal?: AbortSignal };

const storage = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: session lasts until reload */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

function toError(res: Response, body: unknown): ApiError {
  const b = (body && typeof body === "object" ? body : {}) as { code?: string; message?: string | string[]; details?: unknown; requestId?: string };
  const message = Array.isArray(b.message) ? b.message.join(", ") : b.message ?? (res.status >= 500 ? "Something went wrong on our side. Please try again." : res.statusText || "Request failed");
  return new ApiError(res.status, b.code ?? `HTTP_${res.status}`, message, b.details, b.requestId);
}

export function createClient(realm: "viewer" | "admin", refreshPath: string) {
  const refreshKey = `aivistro.${realm}.refresh`;
  let access: string | null = null;
  let refreshing: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();

  const clear = () => { access = null; storage.del(refreshKey); listeners.forEach((l) => l()); };
  const setTokens = (t: Tokens) => { access = t.accessToken; storage.set(refreshKey, t.refreshToken); };

  async function doRefresh(): Promise<boolean> {
    const run = async () => {
      const token = storage.get(refreshKey); // read INSIDE the lock: another tab may have rotated it
      if (!token) return false;
      const res = await fetch(`${API_BASE}${refreshPath}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: token }) });
      const body = await parse(res);
      if (res.ok) { setTokens(body as Tokens); return true; }
      if (res.status === 401 || res.status === 403) clear(); // dead or reused: the user must sign in again
      return false;
    };
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    return locks ? locks.request(`aivistro-refresh-${realm}`, run) : run();
  }
  const refresh = () => (refreshing ??= doRefresh().finally(() => { refreshing = null; }));

  async function raw(path: string, o: Options, withAuth: boolean): Promise<Response> {
    const qs = o.query ? Object.entries(o.query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    if (withAuth && access) headers.Authorization = `Bearer ${access}`;
    return fetch(`${API_BASE}${path}${qs ? `?${qs}` : ""}`, { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, signal: o.signal });
  }

  async function request<T = unknown>(path: string, o: Options = {}): Promise<T> {
    const mode = o.auth ?? "required";
    if (mode !== "none" && !access && storage.get(refreshKey)) await refresh();
    let res: Response;
    try { res = await raw(path, o, mode !== "none"); } catch (e) { if ((e as Error).name === "AbortError") throw e; throw new ApiError(0, "NETWORK", "Can't reach AIVISTRO. Check your connection and try again."); }
    if (res.status === 401 && mode !== "none" && storage.get(refreshKey)) {
      if (await refresh()) res = await raw(path, o, true);
    }
    const body = await parse(res);
    if (!res.ok) throw toError(res, body);
    return body as T;
  }

  return {
    request,
    setTokens,
    clear,
    get hasSession() { return !!access || !!storage.get(refreshKey); },
    get accessToken() { return access; },
    /** Try to restore a session from the stored refresh token (call once at start-up). */
    restore: async () => (storage.get(refreshKey) ? refresh() : false),
    onSignedOut: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

export const viewerApi = createClient("viewer", "/auth/refresh");
