import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError } from "./api/http";
import { analyticsApi, authApi, noticeApi, publicApi, listApi, playbackApi, type ContinueItem, type EpisodeItem, type Notice } from "./api/viewer";
import { Button, COMPANY, Credit, Icon, IconButton, LegalLink, Logo, LogoMark, ToastProvider, initials, useToast, type IconName } from "./shared";
import AuthScreen, { emptyPending, type AuthMode, type AuthPending } from "./viewer/Auth";
import EpisodeGrid from "./viewer/EpisodeGrid";
import { errorText, heroImage, languageName, splitWords, toShow, type Show } from "./viewer/model";
import AccountData from "./viewer/AccountData";
import PaymentHistory from "./viewer/PaymentHistory";
import Plans from "./viewer/Plans";
import Player from "./viewer/Player";
import { AppProvider, useApp } from "./viewer/store";

type Page = AuthMode | "home" | "discover" | "list" | "profile" | "series" | "player" | "plans";
type Nav = (page: Page) => void;
const authPages: Page[] = ["welcome", "signup", "signin", "otp", "forgot", "reset", "verify", "details"];
const moods: [string, string][] = [["Heart Racing", "Thriller"], ["Slow Burn", "Romance"], ["Revenge", "Revenge"], ["A Little Magic", "Fantasy"], ["Dark Secrets", "Mystery"], ["Second Chances", "Drama"]];
const splitTitle = (title: string) => { const [a, b] = splitWords(title); return <>{a}<br /><em>{b}</em></>; };

async function fetchAllEpisodes(ref: string): Promise<EpisodeItem[]> {
  const out: EpisodeItem[] = []; let cursor: string | undefined;
  for (let i = 0; i < 20; i++) { const page = await publicApi.episodes(ref, cursor); out.push(...page.items); if (!page.nextCursor) break; cursor = page.nextCursor; }
  return out;
}

/* ───────────────────────── App chrome ───────────────────────── */

function Sidebar({ page, go, onSignIn }: { page: Page; go: Nav; onSignIn: () => void }) {
  const { user, active, subscription } = useApp();
  const links: { page: Page; icon: IconName; label: string }[] = [
    { page: "home", icon: "home", label: "Home" }, { page: "discover", icon: "discover", label: "Discover" }, { page: "list", icon: "bookmark", label: "My list" },
  ];
  const name = user?.displayName ?? null;
  return <aside className="sidebar">
    <button type="button" className="logo-button" aria-label="AIVISTRO home" onClick={() => go("home")}><Logo /></button>
    <nav className="side-nav" aria-label="Primary">{links.map((link) => <button type="button" key={link.page} className={page === link.page ? "active" : ""} onClick={() => go(link.page)}><Icon name={link.icon} /><span>{link.label}</span></button>)}</nav>
    <div className="sidebar-spacer" />
    {!active && <button type="button" className="premium-tile" onClick={() => go("plans")}><span className="spark"><Icon name="star" size={16} /></span><strong>Every story. Unlocked.</strong><small>One membership, every episode</small><b>Explore Premium <Icon name="arrow" size={14} /></b></button>}
    {name
      ? <button type="button" className="profile-mini" onClick={() => go("profile")}><span className="avatar">{initials(name)}</span><span><b>{name}</b><small>{active ? `Premium${subscription?.current?.planName ? ` · ${subscription.current.planName}` : ""}` : "Free account"}</small></span><Icon name="more" /></button>
      : <button type="button" className="profile-mini" onClick={onSignIn}><span className="avatar"><Icon name="user" size={16} /></span><span><b>Sign in</b><small>Save stories & sync</small></span><Icon name="arrow" size={16} /></button>}
  </aside>;
}

function NotificationsBell() {
  const { signedIn } = useApp();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[] | null>(null);
  const notify = useToast();
  useEffect(() => {
    if (!signedIn) { setUnread(0); return; }
    let live = true;
    const load = () => noticeApi.unread().then((r) => { if (live) setUnread(r.unread); }).catch(() => undefined);
    void load();
    const t = window.setInterval(load, 60000);
    return () => { live = false; window.clearInterval(t); };
  }, [signedIn]);
  const toggle = async () => {
    if (!signedIn) { notify("Sign in to see your notifications"); return; }
    const next = !open; setOpen(next);
    if (next) { try { const r = await noticeApi.list(); setItems(r.items); if (unread) { await noticeApi.readAll(); setUnread(0); } } catch (e) { notify(errorText(e)); } }
  };
  return <div className="notif-wrap"><IconButton icon="bell" label={unread ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => void toggle()} />{unread > 0 && <span className="notif-dot" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
    {open && <div className="notif-panel" role="dialog" aria-label="Notifications"><div className="notif-head"><b>Notifications</b><button type="button" onClick={() => setOpen(false)}>Close</button></div>{!items ? <p>Loading…</p> : items.length ? <ul>{items.map((n) => <li key={n.id} className={n.read ? "" : "unread"}><b>{n.title}</b><span>{n.body}</span><small>{new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small></li>)}</ul> : <p>You're all caught up.</p>}</div>}
  </div>;
}

function Topbar({ go }: { go: Nav }) {
  const { user } = useApp();
  return <header className="topbar">
    <button type="button" className="mobile-logo logo-button" aria-label="AIVISTRO home" onClick={() => go("home")}><LogoMark size={32} /><span className="logo-text">AIVISTRO</span></button>
    <button type="button" className="search-trigger" onClick={() => go("discover")}><Icon name="search" /><span>Search stories, people, moods...</span><kbd>⌘ K</kbd></button>
    <div className="top-actions"><NotificationsBell /><button type="button" className="avatar desktop-avatar" aria-label="Profile" onClick={() => go("profile")}>{user ? initials(user.displayName) : <Icon name="user" size={16} />}</button></div>
  </header>;
}

function BottomNav({ page, go }: { page: Page; go: Nav }) {
  const links: { page: Page; icon: IconName; label: string }[] = [
    { page: "home", icon: "home", label: "Home" }, { page: "discover", icon: "discover", label: "Explore" }, { page: "list", icon: "bookmark", label: "My List" }, { page: "profile", icon: "user", label: "You" },
  ];
  return <nav className="bottom-nav" aria-label="Primary">{links.map((link) => <button type="button" key={link.page} className={page === link.page ? "active" : ""} onClick={() => go(link.page)}><Icon name={link.icon} size={22} /><span>{link.label}</span></button>)}</nav>;
}

function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  return <div className="section-title"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 className="heading">{title}</h2></div>{action && <button type="button" onClick={onAction}>{action}<Icon name="arrow" size={16} /></button>}</div>;
}

function ShowCard({ show, rank, onClick }: { show: Show; rank?: number; onClick: () => void }) {
  return <button type="button" className="show-card" onClick={onClick}>
    <span className="poster-wrap">{rank && <span className="rank">{String(rank).padStart(2, "0")}</span>}<img src={show.image} alt="" loading="lazy" />{show.badge && <span className={`badge ${show.badge.toLowerCase()}`}>{show.badge}</span>}<span className="ep-count">{show.episodes} EP</span><span className="card-play"><Icon name="play" size={19} /></span></span>
    <strong>{show.title}</strong><small>{show.genre}{show.tags[0] && <><i />{show.tags[0]}</>}</small>
  </button>;
}

function ShowRow({ shows, ranked = false, onOpen }: { shows: Show[]; ranked?: boolean; onOpen: (id: string) => void }) {
  return <div className={`show-row ${ranked ? "ranked" : ""}`}>{shows.map((show, index) => <ShowCard key={show.id} show={show} rank={ranked ? index + 1 : undefined} onClick={() => onOpen(show.id)} />)}</div>;
}

function StateCard({ icon, title, text, action, onAction, children }: { icon: IconName; title: string; text: string; action?: string; onAction?: () => void; children?: ReactNode }) {
  return <div className="state-card"><span className="state-icon"><Icon name={icon} size={28} /></span><h2 className="heading">{title}</h2>{children}<p>{text}</p>{action && <Button className="primary" onClick={onAction}>{action}</Button>}</div>;
}

/* ───────────────────────── Home ───────────────────────── */

function Home({ onOpen, onPlay, go, onMood }: { onOpen: (id: string) => void; onPlay: (n: number, id: string) => void; go: Nav; onMood: (genre: string) => void }) {
  const { shows, genres, home, signedIn, active, saved, toggleSave, showById } = useApp();
  const notify = useToast();
  const [banner, setBanner] = useState(0);
  const [tab, setTab] = useState("Popular");
  const [newest, setNewest] = useState<Show[]>([]);
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);

  const banners = useMemo(() => {
    const fromApi = (home?.banners ?? []).map((b) => { const s = b.seriesId ? showById(b.seriesId) : undefined; return s ? { show: s, image: heroImage(s, b.imageUrl) } : null; }).filter((x): x is { show: Show; image: string } => !!x);
    return fromApi.length ? fromApi : shows.slice(0, 3).map((s) => ({ show: s, image: s.image }));
  }, [home, shows, showById]);
  useEffect(() => { publicApi.series({ sort: "newest", limit: 12 }).then((p) => setNewest(p.items.map(toShow))).catch(() => undefined); }, []);
  useEffect(() => { if (!signedIn) { setContinueItems([]); return; } playbackApi.continueWatching().then((p) => setContinueItems(p.items)).catch(() => undefined); }, [signedIn]);
  useEffect(() => {
    if (banners.length < 2) return;
    const t = window.setInterval(() => setBanner((b) => (b + 1) % banners.length), 6000);
    return () => window.clearInterval(t);
  }, [banner, banners.length]);

  if (!shows.length) return <div className="page home-page"><StateCard icon="series" title="New stories are on the way" text="We're getting the first episodes ready. Please check back soon." /></div>;
  const current = banners[banner % banners.length];
  const hero = current.show;
  const tabs = ["Popular", "New", ...genres.slice(0, 5).map((g) => g.name)];
  const picks = tab === "Popular" ? shows : tab === "New" ? newest : shows.filter((s) => s.genre === tab);
  const save = async (id: string) => { try { notify((await toggleSave(id)) ? "Added to your list" : "Removed from your list"); } catch (e) { notify(e instanceof ApiError && e.status === 401 ? "Sign in to save stories" : errorText(e)); } };
  const clickBanner = () => { void analyticsApi.track("banner_click", { entityType: "series", entityId: hero.id }); onOpen(hero.id); };
  return <div className="page home-page">
    <section className="hero">
      <div className="hero-slides">{banners.map((b, i) => <img key={b.show.id} className={i === banner % banners.length ? "on" : ""} src={b.image} alt="" />)}</div>
      <div className="hero-shade" />
      <div className="hero-copy" key={hero.id}>
        <span className="eyebrow">AIVISTRO ORIGINAL · {hero.genre.toUpperCase()}</span>
        <h1 className="display-title">{splitTitle(hero.title)}</h1>
        <p>{hero.desc}</p>
        <div className="meta">{hero.tags[0] && <><span>{hero.tags[0]}</span><i /></>}<span>{hero.episodes} episodes</span><span className="age">{hero.maturity}</span></div>
        <div className="hero-actions"><Button className="primary" icon="play" onClick={() => onPlay(1, hero.id)}>Watch · Ep 1</Button><Button className="glass" icon={saved.has(hero.id) ? "check" : "plus"} onClick={() => void save(hero.id)}>{saved.has(hero.id) ? "In my list" : "My list"}</Button><Button className="glass" onClick={clickBanner}>Details</Button></div>
      </div>
      {banners.length > 1 && <div className="hero-dots" role="tablist" aria-label="Featured stories">{banners.map((b, i) => <button type="button" key={b.show.id} role="tab" aria-selected={i === banner % banners.length} aria-label={b.show.title} className={i === banner % banners.length ? "active" : ""} onClick={() => setBanner(i)} />)}</div>}
    </section>

    {continueItems.length > 0 && <section className="content-section">
      <SectionTitle eyebrow="PICK UP WHERE YOU LEFT" title="Continue watching" />
      <div className="continue-grid">{continueItems.map((h) => { const s = showById(h.series.id); const image = s?.image ?? h.series.posterUrl ?? ""; return <button type="button" key={h.series.id} className="continue-card" onClick={() => onPlay(h.episode.number, h.series.id)}><img src={image} alt="" /><span className="continue-overlay"><span><b>{h.series.title}</b><small>{h.kind === "NEXT" ? "Up next · " : ""}Episode {h.episode.number}{s ? ` of ${s.episodes}` : ""}</small></span><span className="round-play"><Icon name={active ? "play" : "lock"} /></span></span><i><b style={{ width: `${h.progressPercent}%` }} /></i></button>; })}</div>
    </section>}

    <section className="content-section picks-section">
      <div className="cat-tabs" role="tablist" aria-label="Categories">{tabs.map((t) => <button type="button" role="tab" aria-selected={tab === t} key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>
      {picks.length ? <div className="poster-grid">{picks.map((s) => <ShowCard key={s.id} show={s} onClick={() => onOpen(s.id)} />)}</div> : <p className="empty-note">Nothing here yet. New stories land every week.</p>}
    </section>

    <section className="content-section"><SectionTitle eyebrow="EVERYONE'S WATCHING" title="Trending now" /><ShowRow ranked shows={shows.slice(0, 7)} onOpen={onOpen} /></section>

    <section className="editorial-band">
      <div><span className="eyebrow">STORIES. REIMAGINED.</span><h2 className="heading large">Big emotions.<br />Beautifully short.</h2><p>India’s premium destination for short dramas, unexpected turns and unforgettable characters. One membership unlocks every episode.</p><Button className="light" icon="star" onClick={() => go("plans")}>See Membership</Button></div>
      <div className="mini-stack">{shows.slice(0, 3).map((s) => <img key={s.id} src={s.image} alt="" />)}<span><b>1–2</b><small>minutes</small></span></div>
    </section>

    {newest.length > 0 && <section className="content-section"><SectionTitle eyebrow="FRESHLY RELEASED" title="New this week" action="View all" onAction={() => onMood("All stories")} /><ShowRow shows={newest.slice(0, 7)} onOpen={onOpen} /></section>}
    <section className="content-section genre-section"><SectionTitle title="Find your mood" /><div className="genre-row">{moods.filter(([, g]) => genres.some((x) => x.name === g)).map(([label, genre], i) => <button type="button" key={label} className={`genre-pill g${i}`} onClick={() => onMood(genre)}><span>{label}</span><Icon name="arrow" /></button>)}</div></section>
  </div>;
}

/* ───────────────────────── Discover ───────────────────────── */

function Discover({ filter, setFilter, onOpen }: { filter: string; setFilter: (f: string) => void; onOpen: (id: string) => void }) {
  const { genres, shows } = useApp();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"Popular" | "Newest" | "A–Z">("Popular");
  const [results, setResults] = useState<Show[] | null>(null);
  const [error, setError] = useState("");
  const filters = ["All stories", ...genres.map((g) => g.name)];
  const slug = genres.find((g) => g.name === filter)?.slug;

  // Search, filter and sort run on the server so this scales past the first page of series.
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      publicApi.series({ limit: 50, q: query.trim() || undefined, genre: slug, sort: sort === "Newest" ? "newest" : sort === "A–Z" ? "title" : "featured" })
        .then((p) => { if (live) { setResults(p.items.map(toShow)); setError(""); } })
        .catch((e) => { if (live) setError(errorText(e, "Couldn't load stories.")); });
    }, query ? 250 : 0);
    return () => { live = false; window.clearTimeout(t); };
  }, [query, slug, sort]);

  const nextSort = () => setSort(sort === "Popular" ? "Newest" : sort === "Newest" ? "A–Z" : "Popular");
  const feature = shows.find((s) => s.genre === "Romance") ?? shows[0];
  const sameGenre = feature ? shows.filter((s) => s.genre === feature.genre).length : 0;
  return <div className="page discover-page">
    <div className="page-intro"><span className="eyebrow">YOUR NEXT OBSESSION</span><h1 className="display-title small">Find a story<br /><em>worth feeling.</em></h1><label className="large-search"><Icon name="search" /><input aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, genre or mood" />{query && <button type="button" onClick={() => setQuery("")}>Clear</button>}</label></div>
    <div className="filter-bar"><div role="tablist" aria-label="Genres">{filters.map((item) => <button type="button" role="tab" aria-selected={filter === item} key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><Button className="filter-button" onClick={nextSort}>Sort: {sort}</Button></div>
    <div className="curated-grid">
      {feature && <button type="button" className="curated-feature" onClick={() => setFilter(feature.genre)}><img src={feature.image} alt="" /><span className="curated-shade" /><span><small>CURATED COLLECTION</small><b>{feature.title}</b><em>{sameGenre} {feature.genre.toLowerCase()} {sameGenre === 1 ? "story" : "stories"}</em></span></button>}
      <div className="discover-results">{error ? <p className="empty-note">{error}</p> : results === null ? <p className="empty-note">Loading…</p> : <><SectionTitle title={`${filter} · ${results.length} ${results.length === 1 ? "story" : "stories"}`} />{results.length ? <div className="poster-grid">{results.map((s) => <ShowCard key={s.id} show={s} onClick={() => onOpen(s.id)} />)}</div> : <p className="empty-note">{query ? `No stories match “${query}”. Try another title or mood.` : "No stories here yet."}</p>}</>}</div>
    </div>
  </div>;
}

/* ───────────────────────── Series detail ───────────────────────── */

function SeriesDetail({ show, episodes, loading, error, onPlay, onOpen }: { show: Show; episodes: EpisodeItem[] | null; loading: boolean; error: string; onPlay: (n: number) => void; onOpen: (id: string) => void }) {
  const notify = useToast();
  const { shows, active, saved, toggleSave } = useApp();
  const share = async () => {
    void analyticsApi.track("share", { entityType: "series", entityId: show.id });
    try { await navigator.clipboard.writeText(`${window.location.origin}/?series=${show.slug}`); notify("Link copied"); } catch { notify("Sharing isn't available in this browser"); }
  };
  const save = async () => { try { notify((await toggleSave(show.id)) ? "Added to your list" : "Removed from your list"); } catch (e) { notify(e instanceof ApiError && e.status === 401 ? "Sign in to save stories" : errorText(e)); } };
  const more = shows.filter((s) => s.id !== show.id).sort((a, b) => Number(b.genre === show.genre) - Number(a.genre === show.genre)).slice(0, 5);
  const avgMinutes = episodes?.length ? Math.max(1, Math.round(episodes.reduce((n, e) => n + e.durationSeconds, 0) / episodes.length / 60)) : 0;
  const [first, second] = splitWords(show.title);
  return <div className="page series-page">
    <section className="detail-hero">
      <img src={show.image} alt="" /><div className="detail-shade" />
      <div className="detail-copy">
        <span className="eyebrow">AIVISTRO ORIGINAL</span><h1 className="display-title small">{first}<br /><em>{second}</em></h1>
        <div className="rating">{[show.year, show.maturity, languageName(show.language)].filter(Boolean).join(" · ")}</div>
        <p>{show.desc}</p>
        <div className="meta"><span>{show.genre}</span>{show.tags[0] && <><i /><span>{show.tags[0]}</span></>}<i /><span>{show.episodes} episodes</span></div>
        <div className="hero-actions"><Button className="primary" icon="play" onClick={() => onPlay(1)}>Watch · Ep 1</Button><IconButton icon={saved.has(show.id) ? "check" : "plus"} label={saved.has(show.id) ? "Remove from my list" : "Add to my list"} className="glass-icon" onClick={() => void save()} /><IconButton icon="share" label="Share" className="glass-icon" onClick={share} /></div>
      </div>
    </section>
    <section className="detail-body">
      <div className="episode-head"><div><span className="eyebrow">SEASON 1</span><h2 className="heading">Episodes</h2></div><span>{active ? "All episodes unlocked" : "Membership required to watch"}</span></div>
      {error ? <p className="empty-note">{error}</p> : loading && !episodes ? <p className="empty-note">Loading episodes…</p> : episodes && episodes.length ? <EpisodeGrid episodes={episodes} onPick={onPlay} /> : <p className="empty-note">Episodes are coming soon.</p>}
      <div className="about-grid"><div><span className="eyebrow">ABOUT THE STORY</span><h2 className="heading">{show.title}</h2></div><div><p>Produced by AIVISTRO Studios · Original language: {languageName(show.language)}</p>{avgMinutes > 0 && <p>Episodes run about {avgMinutes} {avgMinutes === 1 ? "minute" : "minutes"}.</p>}<div className="tags">{show.tags.map((t) => <span key={t}>{t}</span>)}</div></div></div>
      {more.length > 0 && <div className="content-section"><SectionTitle title="More like this" /><ShowRow shows={more} onOpen={onOpen} /></div>}
    </section>
  </div>;
}

/* ───────────────────────── Library and profile ───────────────────────── */

function MyList({ onOpen, go }: { onOpen: (id: string) => void; go: Nav }) {
  const { shows, saved, signedIn } = useApp();
  const list = shows.filter((s) => saved.has(s.id));
  return <div className="page placeholder-page"><span className="eyebrow">YOUR AIVISTRO</span><h1 className="display-title small">Your collection</h1>
    {list.length ? <div className="poster-grid list-grid">{list.map((s) => <ShowCard key={s.id} show={s} onClick={() => onOpen(s.id)} />)}</div> : <StateCard icon="bookmark" title={signedIn ? "Nothing saved yet" : "Sign in to build your list"} text={signedIn ? "Tap “My list” on any story to keep it here for later." : "Your saved stories sync across all your devices."} action="Browse stories" onAction={() => go("discover")} />}
  </div>;
}

function Profile({ go, onSignIn, onSignOut }: { go: Nav; onSignIn: () => void; onSignOut: () => void }) {
  const { user, subscription, active } = useApp();
  const until = subscription?.entitledUntil ? new Date(subscription.entitledUntil).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
  return <div className="page placeholder-page"><span className="eyebrow">YOUR AIVISTRO</span><h1 className="display-title small">Your profile</h1>
    <div className="state-card"><span className="state-icon">{user ? <b>{initials(user.displayName)}</b> : <Icon name="user" size={28} />}</span><h2 className="heading">{user?.displayName ?? "Guest"}</h2>
      {user && <small>{user.email ?? user.phone}</small>}
      {active && <div className="membership-status"><b>AIVISTRO Premium</b><span><i /> ACTIVE</span><small>Active until {until}{subscription?.current?.planName ? ` · ${subscription.current.planName}` : ""}</small></div>}
      <p>{!user ? "Sign in to save stories, sync your progress and unlock Premium on every device." : active ? "Your membership doesn't renew automatically. Extend it any time from the plans page." : "You're on the free plan. Subscribe to unlock every episode."}</p>
      <div className="state-actions">
        {!user ? <Button className="primary" onClick={onSignIn}>Sign in</Button> : <><Button className="primary" onClick={() => go("plans")}>{active ? "Extend membership" : "Subscribe to Watch"}</Button><Button className="outline" icon="logout" onClick={onSignOut}>Sign out</Button></>}
      </div>
    </div>
    {user && <><PaymentHistory /><AccountData onDeleted={() => go("home")} /></>}
  </div>;
}

/* ───────────────────────── App ───────────────────────── */

function Splash({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return <div className="splash" role="status"><Logo />{error ? <><p>{error}</p><Button className="primary" onClick={onRetry}>Try again</Button></> : <span className="processing-ring" />}</div>;
}

function AppInner() {
  const { status, loadError, reload, user, signedIn, active, shows, showById, signOut, refreshSubscription } = useApp();
  const notify = useToast();
  const initial = useMemo<{ page: Page; token: string }>(() => {
    const t = new URLSearchParams(window.location.search).get("token") ?? "";
    if (window.location.pathname === "/verify-email" && t) return { page: "verify", token: t };
    if (window.location.pathname === "/reset-password" && t) return { page: "reset", token: t };
    return { page: "welcome", token: "" };
  }, []);
  const [page, setPage] = useState<Page>(initial.page);
  const [pending, setPending] = useState<AuthPending>({ ...emptyPending, token: initial.token });
  const [authIntent, setAuthIntent] = useState<{ page: Page; play?: { id: string; n: number } }>({ page: "home" });
  const [currentId, setCurrentId] = useState<string>("");
  const [episode, setEpisode] = useState(1);
  const [episodes, setEpisodes] = useState<{ id: string; items: EpisodeItem[] | null; loading: boolean; error: string }>({ id: "", items: null, loading: false, error: "" });
  const [discoverFilter, setDiscoverFilter] = useState("All stories");
  const [plansBack, setPlansBack] = useState<Page>("home");
  const [plansPlay, setPlansPlay] = useState<{ id: string; n: number } | null>(null); // the episode the user was trying to watch when the paywall appeared
  const seenOpen = useRef(false);
  const restored = useRef(false);

  const go = useCallback((next: Page) => { setPage(next); window.scrollTo(0, 0); }, []);
  const goStr = useCallback((next: string) => go(next as Page), [go]);

  useEffect(() => { if (initial.token) window.history.replaceState(null, "", "/"); }, [initial.token]);
  useEffect(() => { if (status === "ready" && !seenOpen.current) { seenOpen.current = true; void analyticsApi.track("app_open"); } }, [status]);
  // A restored session skips the welcome screen.
  useEffect(() => { if (status === "ready" && signedIn && !restored.current) { restored.current = true; setPage((p) => (p === "welcome" ? "home" : p)); } }, [status, signedIn]);

  const loadEpisodes = useCallback(async (id: string) => {
    setEpisodes((e) => ({ id, items: e.id === id ? e.items : null, loading: true, error: "" }));
    try { const items = await fetchAllEpisodes(id); setEpisodes({ id, items, loading: false, error: "" }); return items; }
    catch (e) { setEpisodes({ id, items: null, loading: false, error: errorText(e, "Couldn't load episodes.") }); return null; }
  }, []);

  const startAuth = (mode: string, intent: { page: Page; play?: { id: string; n: number } } = { page: "home" }) => { setAuthIntent(intent); goStr(mode); };
  const signIn = () => startAuth("signin", { page: page === "welcome" ? "home" : page });
  const openSeries = (id: string) => { setCurrentId(id); go("series"); void loadEpisodes(id); };

  /** Always re-reads access from the server at the moment of playing; the UI's lock icons are only hints. */
  const playEpisode = useCallback(async (n: number, id: string) => {
    setCurrentId(id); setEpisode(n);
    const items = await loadEpisodes(id);
    const e = items?.find((x) => x.number === n);
    if (!e) { notify("That episode isn't available right now."); return; }
    if (!e.access.allowed) {
      if (e.access.requiresAuth) { startAuth("signin", { page: "home", play: { id, n } }); return; }
      setPlansBack("series"); setPlansPlay({ id, n }); go("plans");
      return;
    }
    go("player");
  }, [loadEpisodes, notify, go, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shareable link: /?series=<slug> opens that series once the catalog has loaded.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (status !== "ready" || deepLinked.current) return;
    deepLinked.current = true;
    const slug = new URLSearchParams(window.location.search).get("series");
    const target = slug ? shows.find((x) => x.slug === slug) : undefined;
    if (target) { setPage((p) => (p === "welcome" ? "home" : p)); openSeries(target.id); }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Browser tab title follows the screen (accessibility + history + sharing).
  useEffect(() => {
    const names: Partial<Record<Page, string>> = { home: "Home", discover: "Discover", list: "My list", profile: "Your profile", plans: "Premium plans", signin: "Sign in", signup: "Create account", welcome: "Short dramas, beautifully told" };
    const base = "AIVISTRO";
    const t = page === "series" || page === "player" ? (showById(currentId)?.title ?? base) : names[page];
    document.title = t ? `${t} · ${base}` : base;
  }, [page, currentId, showById]);

  const authenticated = () => {
    const intent = authIntent; setAuthIntent({ page: "home" });
    if (intent.play) { void playEpisode(intent.play.n, intent.play.id); return; }
    go(intent.page);
  };
  const doSignOut = async () => { await signOut(); notify("Signed out"); go("home"); };
  const openMood = (genre: string) => { setDiscoverFilter(genre); go("discover"); };

  // After a subscription change, refresh the lock icons for the open series.
  useEffect(() => { if (page === "series" && currentId) void loadEpisodes(currentId); }, [active, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (signedIn && (page === "plans" || page === "player")) void refreshSubscription(); }, [page, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !authPages.includes(page) && page !== "player" && page !== "plans") { e.preventDefault(); go("discover"); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, go]);

  const { saved, toggleSave } = useApp();
  if (status === "loading" || (loadError && !shows.length)) return <Splash error={loadError} onRetry={reload} />;
  const show = showById(currentId);
  const toggleSaveToast = async (id: string) => { try { notify((await toggleSave(id)) ? "Added to your list" : "Removed from your list"); } catch (e) { notify(e instanceof ApiError && e.status === 401 ? "Sign in to save stories" : errorText(e)); } };

  let view: ReactNode;
  if (authPages.includes(page)) {
    view = <AuthScreen key={page} mode={page as AuthMode} go={goStr} startAuth={(m) => startAuth(m)} pending={pending} setPending={setPending} onAuthenticated={authenticated} />;
  } else if (page === "player" && show && episodes.id === show.id && episodes.items) {
    view = <Player key={`${show.id}-${episode}`} show={show} episodes={episodes.items} number={episode} saved={saved.has(show.id)} onSave={() => void toggleSaveToast(show.id)}
      onEpisode={(n) => void playEpisode(n, show.id)} onBack={() => go("series")}
      onPaywall={() => { setPlansBack("series"); setPlansPlay({ id: show.id, n: episode }); go("plans"); }} onNeedAuth={() => startAuth("signin", { page: "home", play: { id: show.id, n: episode } })} />;
  } else if (page === "plans") {
    view = <Plans go={goStr} back={plansBack} onRequireAuth={() => startAuth("signin", { page: "plans" })} onStartWatching={() => { const p = plansPlay; setPlansPlay(null); if (p) void playEpisode(p.n, p.id); else go("home"); }} />;
  } else {
    view = <div className="app-shell">
      <Sidebar page={page} go={go} onSignIn={signIn} />
      <div className="main-shell">
        <Topbar go={go} />
        {page === "home" && <Home onOpen={openSeries} onPlay={(n, id) => void playEpisode(n, id)} go={go} onMood={openMood} />}
        {page === "discover" && <Discover filter={discoverFilter} setFilter={setDiscoverFilter} onOpen={openSeries} />}
        {(page === "series" || page === "player") && show && <SeriesDetail show={show} episodes={episodes.id === show.id ? episodes.items : null} loading={episodes.loading} error={episodes.id === show.id ? episodes.error : ""} onPlay={(n) => void playEpisode(n, show.id)} onOpen={openSeries} />}
        {page === "list" && <MyList onOpen={openSeries} go={go} />}
        {page === "profile" && <Profile go={go} onSignIn={signIn} onSignOut={() => void doSignOut()} />}
        <footer className="site-footer"><Logo /><p>Stories. Reimagined.</p><span className="footer-meta"><span>© 2026 {COMPANY}. All rights reserved.</span><span className="footer-links"><LegalLink page="terms">Terms</LegalLink> · <LegalLink page="privacy">Privacy</LegalLink> · <LegalLink page="refunds">Refunds</LegalLink></span><Credit /></span></footer>
      </div>
      <BottomNav page={page} go={go} />
    </div>;
  }
  void user; void listApi; void authApi;
  return view;
}

export default function App() {
  return <ToastProvider><AppProvider><AppInner /></AppProvider></ToastProvider>;
}
