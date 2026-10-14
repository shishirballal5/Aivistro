import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Icon, IconButton, type IconName } from "../shared";

/* ── Formatting ── */
export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const inrCompact = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : inr(n));
export const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : String(Math.round(n)));
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtDuration = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
export const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  const d = Math.round(mins / 1440);
  return d === 1 ? "Yesterday" : `${d} days ago`;
};
export const pct = (cur: number, prev: number) => {
  const v = prev ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;
  return { text: `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`, up: v >= 0 };
};
export const initialsOf = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

export function downloadFile(name: string, content: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function toCsv(rows: (string | number)[][]) {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/* ── Layout bits ── */
export function PageHead({ eyebrow, title, sub, actions, back }: { eyebrow: string; title: string; sub?: string; actions?: ReactNode; back?: { label: string; onClick: () => void } }) {
  return <div className="a-head">
    {back && <button type="button" className="a-back" onClick={back.onClick}><Icon name="back" size={16} /> {back.label}</button>}
    <div className="a-head-row"><div><span className="a-eyebrow">{eyebrow}</span><h1 className="heading large">{title}</h1>{sub && <p>{sub}</p>}</div>{actions && <div className="a-actions">{actions}</div>}</div>
  </div>;
}

export function Panel({ title, eyebrow, action, children, flush, className = "" }: { title?: string; eyebrow?: string; action?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return <section className={`a-panel ${flush ? "flush" : ""} ${className}`}>
    {(title || action) && <div className="a-panel-head"><div>{eyebrow && <span className="a-eyebrow">{eyebrow}</span>}{title && <h2 className="heading">{title}</h2>}</div>{action}</div>}
    {children}
  </section>;
}

export function Stat({ icon, label, value, delta, note }: { icon: IconName; label: string; value: string; delta?: { text: string; up: boolean }; note?: string }) {
  return <div className="a-stat"><span className="a-stat-icon"><Icon name={icon} size={18} /></span><small>{label}</small><strong>{value}</strong>{delta && <em className={delta.up ? "up" : "down"}>{delta.text} <i>{note ?? "vs previous"}</i></em>}{!delta && note && <em><i>{note}</i></em>}</div>;
}

export function Pill({ tone = "grey", children }: { tone?: "green" | "amber" | "grey" | "red" | "violet" | "blue"; children: ReactNode }) {
  return <span className={`a-pill ${tone}`}>{children}</span>;
}

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  return <span className="a-avatar" style={{ width: size, height: size, fontSize: size * 0.34 }}>{initialsOf(name)}</span>;
}

export function Field({ label, hint, children, full }: { label: string; hint?: string; children: ReactNode; full?: boolean }) {
  return <label className={`a-field ${full ? "full" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`a-toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}><i /></button>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <label className="a-search"><Icon name="search" size={16} /><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />{value && <button type="button" aria-label="Clear" onClick={() => onChange("")}><Icon name="close" size={14} /></button>}</label>;
}

export function RangeTabs<T extends number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: T[] }) {
  return <div className="a-tabs" role="tablist">{options.map((o) => <button type="button" role="tab" aria-selected={value === o} key={o} className={value === o ? "active" : ""} onClick={() => onChange(o)}>Last {o} days</button>)}</div>;
}

export function Empty({ icon = "search", title, text }: { icon?: IconName; title: string; text?: string }) {
  return <div className="a-empty"><span><Icon name={icon} size={22} /></span><b>{title}</b>{text && <p>{text}</p>}</div>;
}

/* ── Modal & confirm ── */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return <div className="a-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`a-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2 className="heading">{title}</h2><IconButton icon="close" label="Close" onClick={onClose} /></header>
      <div className="a-modal-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </div>
  </div>;
}

export type ConfirmState = { title: string; text: string; label: string; danger?: boolean; onConfirm: () => void } | null;
export function Confirm({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  if (!state) return null;
  return <Modal title={state.title} onClose={onClose} footer={<><Button className="outline" onClick={onClose}>Cancel</Button><Button className={state.danger ? "a-danger" : "primary"} onClick={() => { state.onConfirm(); onClose(); }}>{state.label}</Button></>}><p className="a-muted">{state.text}</p></Modal>;
}

/* ── Row menu (fixed-position so tables never clip it) ── */
export type MenuItem = { label: string; icon?: IconName; onClick: () => void; danger?: boolean };
export function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const btn = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const down = (e: MouseEvent) => { if (!btn.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".a-menu-pop")) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [pos]);
  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    setPos(r.bottom > window.innerHeight - 240 ? { bottom: window.innerHeight - r.top + 6, right } : { top: r.bottom + 6, right });
  };
  return <div className="a-menu" ref={btn}>
    <IconButton icon="more" label={label} onClick={() => (pos ? setPos(null) : open())} />
    {pos && <div className="a-menu-pop" role="menu" style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}>{items.map((i) => <button type="button" role="menuitem" key={i.label} className={i.danger ? "danger" : ""} onClick={() => { setPos(null); i.onClick(); }}>{i.icon && <Icon name={i.icon} size={16} />}{i.label}</button>)}</div>}
  </div>;
}

/* ── Pagination ── */
export function usePaged<T>(items: T[], size: number) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const cur = Math.min(page, pages);
  const slice = useMemo(() => items.slice((cur - 1) * size, cur * size), [items, cur, size]);
  return { slice, page: cur, pages, setPage, total: items.length, size };
}
export function Pager({ page, pages, total, size, setPage }: { page: number; pages: number; total: number; size: number; setPage: (p: number) => void }) {
  if (!total) return null;
  return <div className="a-pager"><span>Showing {(page - 1) * size + 1}–{Math.min(total, page * size)} of {total}</span><div><Button className="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="a-page-no">{page} / {pages}</span><Button className="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>;
}

/* ── Charts ── */
export function AreaChart({ values, labels, format }: { values: number[]; labels: string[]; format: (n: number) => string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 170;
  const max = Math.max(1, ...values) * 1.12;
  const pts = values.map((v, i) => [values.length === 1 ? W / 2 : (i / (values.length - 1)) * W, H - (v / max) * (H - 10) - 2]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * (labels.length - 1)));
  return <div className="a-chart-wrap">
    <div className="a-chart" onMouseLeave={() => setHover(null)} onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - r.left) / r.width) * (values.length - 1))))); }}>
      <div className="a-grid-lines"><i /><i /><i /><i /></div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id={`${id}f`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7b5cff" stopOpacity=".38" /><stop offset="1" stopColor="#7b5cff" stopOpacity="0" /></linearGradient><linearGradient id={`${id}s`} x1="0" x2="1"><stop offset="0" stopColor="#3fa9ff" /><stop offset=".55" stopColor="#7b5cff" /><stop offset="1" stopColor="#ff5fa8" /></linearGradient></defs>
        <path d={`${line} L${W},${H} L0,${H}Z`} fill={`url(#${id}f)`} />
        <path d={line} fill="none" stroke={`url(#${id}s)`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {hover !== null && <><i className="a-cursor" style={{ left: `${(hover / Math.max(1, values.length - 1)) * 100}%` }} /><div className="a-tip" style={{ left: `${(hover / Math.max(1, values.length - 1)) * 100}%` }}><b>{format(values[hover])}</b><small>{labels[hover]}</small></div></>}
    </div>
    <div className="a-axis">{ticks.map((t, i) => <span key={i}>{labels[t]}</span>)}</div>
  </div>;
}

export function BarList({ items, format, total }: { items: { label: string; value: number; note?: string }[]; format: (n: number) => string; total?: number }) {
  const max = total ?? Math.max(1, ...items.map((i) => i.value));
  return <div className="a-bars">{items.map((i) => <div key={i.label}><span><b>{i.label}</b><small>{i.note ?? format(i.value)}</small></span><div><i style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} /></div></div>)}</div>;
}

export const chartColors = ["#3fa9ff", "#7b5cff", "#ff5fa8", "#ffa15c", "#5be28f"];
export function Donut({ parts, center }: { parts: { label: string; value: number }[]; center?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  let acc = 0;
  const stops = parts.map((p, i) => { const from = (acc / total) * 100; acc += p.value; return `${chartColors[i % chartColors.length]} ${from}% ${(acc / total) * 100}%`; }).join(", ");
  return <div className="a-donut"><div style={{ background: `conic-gradient(${stops || "#1d2240 0 100%"})` }}><span>{center ?? ""}</span></div><ul>{parts.map((p, i) => <li key={p.label}><i style={{ background: chartColors[i % chartColors.length] }} />{p.label}<b>{Math.round((p.value / total) * 100)}%</b></li>)}</ul></div>;
}
