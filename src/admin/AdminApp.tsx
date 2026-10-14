import { useEffect, useMemo, useState } from "react";
import { adminRequest } from "../api/admin";
import { Button, Credit, Icon, IconButton, Logo, ToastProvider, useToast, type IconName } from "../shared";
import AdminLogin from "./Login";
import { AdminSessionProvider, useAdminSession } from "./session";
import { Avatar, Modal } from "./ui";
import Dashboard from "./pages/Dashboard";
import { SeriesForm, SeriesList } from "./pages/SeriesPages";
import EpisodesPage from "./pages/EpisodesPage";
import UsersPage from "./pages/UsersPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import BannersPage from "./pages/BannersPage";
import NotificationsPage from "./pages/NotificationsPage";
import SettingsPage from "./pages/SettingsPage";
import "./admin.css";

/* AIVISTRO Control Centre: a separate app served from /admin.html (see admin-main.tsx).
   Every page talks to the backend; the server enforces permissions, the UI only hides what would be refused. */

type NavItem = { key: string; label: string; icon: IconName; any: string[] };
const nav: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard", any: ["analytics.read"] },
  { key: "series", label: "Series", icon: "series", any: ["catalog.read"] },
  { key: "episodes", label: "Episodes", icon: "play", any: ["catalog.read"] },
  { key: "users", label: "Users", icon: "users", any: ["users.read"] },
  { key: "subscriptions", label: "Subscriptions", icon: "card", any: ["subscriptions.read", "payments.read", "plans.manage"] },
  { key: "analytics", label: "Analytics", icon: "chart", any: ["analytics.read"] },
  { key: "banners", label: "Banners", icon: "bookmark", any: ["catalog.read"] },
  { key: "notifications", label: "Notifications", icon: "bell", any: ["notifications.send"] },
  { key: "settings", label: "Team & security", icon: "settings", any: [] }, // everyone can manage their own password and sessions
];

function useRoute(defaultRoute: string) {
  const read = () => window.location.hash.replace(/^#\/?/, "") || defaultRoute;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const h = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (p: string) => { window.location.hash = `/${p}`; };
  return [route, go] as const;
}

type SeriesHit = { id: string; title: string; status: string };

function CommandPalette({ onClose, go, items }: { onClose: () => void; go: (p: string) => void; items: NavItem[] }) {
  const { can } = useAdminSession();
  const [q, setQ] = useState("");
  const [series, setSeries] = useState<SeriesHit[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (!term || !can("catalog.read")) { setSeries([]); return; }
    let live = true;
    const t = window.setTimeout(() => { adminRequest<{ items: SeriesHit[] }>("/admin/series", { query: { q: term, limit: 5 } }).then((r) => { if (live) setSeries(r.items); }).catch(() => undefined); }, 200);
    return () => { live = false; window.clearTimeout(t); };
  }, [q, can]);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const sections = items.filter((n) => !t || n.label.toLowerCase().includes(t)).map((n) => ({ label: n.label, hint: "Section", path: n.key, icon: n.icon }));
    const hits = series.map((s) => ({ label: s.title, hint: `Series · ${s.status}`, path: `series/${s.id}/edit`, icon: "series" as IconName }));
    return [...sections, ...hits].slice(0, 9);
  }, [items, q, series]);
  const pick = (path: string) => { go(path); onClose(); };
  return <Modal title="Search" onClose={onClose}>
    <label className="a-search big"><Icon name="search" size={18} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && results[0]) pick(results[0].path); }} placeholder="Jump to a section or find a series" /></label>
    <ul className="a-results">{results.map((r) => <li key={`${r.hint}-${r.path}`}><button type="button" onClick={() => pick(r.path)}><Icon name={r.icon} size={16} /><span>{r.label}</span><small>{r.hint}</small></button></li>)}</ul>
  </Modal>;
}

function AdminShell() {
  const notify = useToast();
  const { admin, canAny, signOut } = useAdminSession();
  const allowed = useMemo(() => nav.filter((n) => n.any.length === 0 || canAny(...n.any)), [canAny]);
  const [route, go] = useRoute(allowed[0]?.key ?? "settings");
  const [navOpen, setNavOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const [section, a, b] = route.split("/");
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch(true); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => { setNavOpen(false); }, [route]);

  const current = nav.find((n) => n.key === section) ?? allowed[0];
  const permitted = !!current && allowed.some((n) => n.key === current.key);
  let page;
  if (!permitted) page = <div className="a-head"><h1 className="heading large">No access</h1><p>Your role doesn't include this section.</p></div>;
  else if (current.key === "series") page = a === "new" ? <SeriesForm go={go} /> : a && b === "edit" ? <SeriesForm key={a} id={a} go={go} /> : <SeriesList go={go} />;
  else if (current.key === "episodes") page = <EpisodesPage seriesId={a || undefined} go={go} />;
  else if (current.key === "users") page = <UsersPage />;
  else if (current.key === "subscriptions") page = <SubscriptionsPage />;
  else if (current.key === "analytics") page = <AnalyticsPage />;
  else if (current.key === "banners") page = <BannersPage />;
  else if (current.key === "notifications") page = <NotificationsPage />;
  else if (current.key === "settings") page = <SettingsPage />;
  else page = <Dashboard go={go} />;

  const me = admin?.name ?? "Admin";
  const role = admin?.roles[0]?.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) ?? "";
  return <div className="admin-shell">
    <aside className={`admin-sidebar ${navOpen ? "open" : ""}`}>
      <div className="a-side-top"><Logo admin /><IconButton icon="close" label="Close menu" className="a-close-nav" onClick={() => setNavOpen(false)} /></div>
      <span className="nav-label">WORKSPACE</span>
      <nav aria-label="Admin">{allowed.map((n) => <button type="button" key={n.key} className={current?.key === n.key ? "active" : ""} onClick={() => go(n.key)}><Icon name={n.icon} /><span>{n.label}</span></button>)}</nav>
      <Credit />
      <div className="admin-user"><Avatar name={me} size={36} /><span><b>{me}</b><small>{role}</small></span><button type="button" className="admin-logout" aria-label="Sign out" title="Sign out" onClick={() => void signOut().then(() => notify("Signed out"))}><Icon name="logout" size={18} /></button></div>
    </aside>
    {navOpen && <button type="button" className="a-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />}
    <main className="admin-main">
      <header className="admin-top">
        <IconButton icon="menu" label="Open menu" className="a-burger" onClick={() => setNavOpen(true)} />
        <button type="button" className="admin-search" onClick={() => setSearch(true)}><Icon name="search" />Search anything...<kbd>⌘ K</kbd></button>
        <div><Button className="outline a-hide-sm" onClick={() => window.location.assign(import.meta.env.BASE_URL)}>View site</Button></div>
      </header>
      {page}
    </main>
    {search && <CommandPalette onClose={() => setSearch(false)} go={go} items={allowed} />}
  </div>;
}

function AdminRoot() {
  const { status } = useAdminSession();
  useEffect(() => { document.title = "AIVISTRO Control Centre"; }, []);
  if (status === "loading") return <div className="admin-login"><span className="processing-ring" role="status" aria-label="Loading" /></div>;
  return status === "in" ? <AdminShell /> : <AdminLogin />;
}

export default function AdminApp() {
  return <ToastProvider><AdminSessionProvider><AdminRoot /></AdminSessionProvider></ToastProvider>;
}
