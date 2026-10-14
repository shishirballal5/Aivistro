import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from "react";

/* Building blocks shared by the viewer app (App.tsx) and the separate admin app (admin/AdminApp.tsx). */


export type IconName =
  | "home" | "discover" | "bookmark" | "download" | "user" | "search" | "play" | "pause" | "plus" | "bell" | "arrow"
  | "star" | "lock" | "heart" | "share" | "more" | "back" | "volume" | "mute" | "captions" | "expand" | "dashboard"
  | "series" | "users" | "card" | "chart" | "settings" | "upload" | "calendar" | "check" | "close" | "flame" | "logout" | "edit" | "trash" | "menu" | "up" | "down" | "copy" | "send";

const iconPaths: Record<IconName, ReactNode> = {
  home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13v-9.5M9 20v-6h6v6" /></>,
  discover: <><circle cx="12" cy="12" r="8.5" /><path d="m14.8 9.2-2 5.6-5.6 2 2-5.6 5.6-2Z" /></>,
  bookmark: <path d="M6.5 4.5h11v16l-5.5-3.8-5.5 3.8v-16Z" />,
  download: <path d="M12 3v12m-4-4 4 4 4-4M5 20h14" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  play: <path d="m9 6 9 6-9 6V6Z" />,
  pause: <path d="M8.5 5v14M15.5 5v14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  bell: <><path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 6 2.5 6 2.5 7.5H4c0-1.5 2.5-1.5 2.5-7.5Z" /><path d="M10 21h4" /></>,
  arrow: <path d="m9 5 7 7-7 7" />,
  star: <path d="m12 3 2.7 5.6 6.2.9-4.5 4.4 1.1 6.1-5.5-2.9L6.5 20l1.1-6.1-4.5-4.4 6.2-.9L12 3Z" />,
  lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3" /></>,
  heart: <path d="M20.8 8.5c0 6-8.8 11-8.8 11s-8.8-5-8.8-11a4.7 4.7 0 0 1 8.8-2.3 4.7 4.7 0 0 1 8.8 2.3Z" />,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
  back: <path d="m15 5-7 7 7 7" />,
  volume: <><path d="M5 10v4h4l5 4V6L9 10H5Z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11" /></>,
  mute: <><path d="M5 10v4h4l5 4V6L9 10H5Z" /><path d="m17.5 9.5 4 5M21.5 9.5l-4 5" /></>,
  captions: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 10a2 2 0 1 0 0 4M18 10a2 2 0 1 0 0 4" /></>,
  expand: <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  series: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m10 9 5 3-5 3V9Z" /></>,
  users: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20a6 6 0 0 1 12 0M14 15a5 5 0 0 1 7 4.5" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h4" /></>,
  chart: <path d="M4 20V10m5 10V4m6 16v-7m5 7V7" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5V10.5l2-1.5-2-3.4-2.5 1A8 8 0 0 0 14 5L13.5 2h-3L10 5a8 8 0 0 0-2.5 1.6l-2.5-1L3 9l2 1.5v3L3 15l2 3.4 2.5-1A8 8 0 0 0 10 19l.5 3h3l.5-3a8 8 0 0 0 2.5-1.6l2.5 1 2-3.4-2-1.5Z" /></>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M4 15v5h16v-5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="M5 5 19 19M19 5 5 19" />,
  flame: <path d="M12 3c.8 3.4 5 5.2 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.2 1.800 1 2.700 2 2.700C10.800 9 10.500 5.800 12 3Z" />,
  logout: <path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" />,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  up: <path d="m5 15 7-7 7 7" />,
  down: <path d="m5 9 7 7 7-7" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  send: <path d="M21 3 3 10.5l7 2.5 2.5 7L21 3ZM10 13l11-10" />,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

/* ───────────────────────── Shared UI ───────────────────────── */

export const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function Button({ children, className = "", icon, onClick, disabled, type = "button" }: { children?: ReactNode; className?: string; icon?: IconName; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return <button type={type} className={`button ${className}`} onClick={onClick} disabled={disabled}>{icon && <Icon name={icon} size={18} />}{children}</button>;
}

export function IconButton({ icon, label, className = "", onClick }: { icon: IconName; label: string; className?: string; onClick?: () => void }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} onClick={onClick}><Icon name={icon} /></button>;
}

export function LogoMark({ size = 30 }: { size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs><linearGradient id={id} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse"><stop stopColor="#3fa9ff" /><stop offset=".45" stopColor="#7b5cff" /><stop offset=".78" stopColor="#ff5fa8" /><stop offset="1" stopColor="#ffa15c" /></linearGradient></defs>
    <path d="M6 26 16 6l10 20" fill="none" stroke={`url(#${id})`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m13.4 17.6 5.4 3.2-5.4 3.2Z" fill="#fff" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>;
}

export const COMPANY = "Kreekaravat Technologies";
export function Credit({ className = "" }: { className?: string }) {
  return <span className={`credit ${className}`}>Built by <b>{COMPANY}</b></span>;
}

export function Logo({ admin = false }: { admin?: boolean }) {
  return <span className="logo-wrap"><LogoMark /><span className="logo-text">AIVISTRO{admin && <small> CONTROL CENTRE</small>}</span></span>;
}

export const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "AV";
export const formatDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
export const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
export const formatCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState("");
  const timer = useRef<number>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(""), 2600);
  }, []);
  return <ToastContext.Provider value={notify}>{children}{toast && <div className="toast" role="status">{toast}</div>}</ToastContext.Provider>;
}


/** Links to the static legal pages in public/legal (draft text until a lawyer has reviewed it). */
export function LegalLink({ page, children }: { page: "terms" | "privacy" | "refunds"; children: ReactNode }) {
  return <a href={`/legal/${page}.html`} target="_blank" rel="noopener noreferrer">{children}</a>;
}
