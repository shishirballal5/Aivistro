import { Button } from "../../shared";
import { Empty } from "../ui";
import type { Dashboard } from "../../api/admin-insights";

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  const denied = /permission|forbidden|403/i.test(message);
  return <div className="a-panel"><Empty icon="lock" title={denied ? "You don't have permission to view this" : "Couldn't load this page"} text={denied ? "Ask a super admin for the analytics.read permission." : message} /><div style={{ display: "flex", justifyContent: "center", paddingBottom: 18 }}><Button className="outline" onClick={onRetry}>Retry</Button></div></div>;
}

export function Freshness({ d }: { d: Dashboard }) {
  const secs = Math.max(0, Math.round((Date.now() - new Date(d.generatedAt).getTime()) / 1000));
  const when = secs < 10 ? "just now" : secs < 90 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  return <span className="a-muted" style={{ fontSize: 12 }}>{d.cached ? `Cached result, computed ${when}` : `Computed ${when}`} · server caches for 60s · UTC days</span>;
}
