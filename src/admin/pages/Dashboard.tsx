import { useState } from "react";
import { Button, Icon } from "../../shared";
import { DASHBOARD_DAYS, getDashboard, type DashboardDays } from "../../api/admin-insights";
import { useAsync } from "../hooks";
import { useAdminSession } from "../session";
import { AreaChart, Empty, PageHead, Panel, RangeTabs, Stat, compact } from "../ui";
import { ErrorBox, Freshness, rupees, shortDay } from "./DashboardParts";

type Metric = "revenue" | "users" | "plays";

export default function Dashboard({ go }: { go: (p: string) => void }) {
  const { can } = useAdminSession();
  const [days, setDays] = useState<DashboardDays>(30);
  const [metric, setMetric] = useState<Metric>("revenue");
  const { data: d, error, loading, reload } = useAsync(() => getDashboard(days), [days]);

  const links = [
    { key: "series", label: "Manage series", perm: "catalog.read" }, { key: "users", label: "Users", perm: "users.read" },
    { key: "subscriptions", label: "Subscriptions & payments", perm: "subscriptions.read" }, { key: "banners", label: "Banners & homepage", perm: "catalog.read" },
    { key: "analytics", label: "Detailed analytics", perm: "analytics.read" },
  ].filter((l) => can(l.perm));

  const series = d ? (metric === "revenue" ? d.daily.revenuePaise : metric === "users" ? d.daily.newUsers : d.daily.playbackStarts) : [];
  const fmt = metric === "revenue" ? rupees : (n: number) => `${n.toLocaleString("en-IN")} ${metric === "users" ? "new users" : "plays"}`;
  const hasData = !!d && (d.totals.users > 0 || d.totals.playbackStarts > 0 || d.totals.revenue.payments > 0);

  return <div className="a-page">
    <PageHead eyebrow="OVERVIEW" title="Dashboard" sub={`Real figures from the system of record for the last ${days} days.`} actions={<><RangeTabs<DashboardDays> value={days} onChange={setDays} options={DASHBOARD_DAYS} /><Button className="outline" onClick={reload} disabled={loading}>Refresh</Button></>} />
    {error && !d ? <ErrorBox message={error} onRetry={reload} /> : !d ? <div className="a-panel"><p className="a-muted" role="status">Loading dashboard…</p></div> : <>
      {error && <div className="a-error" role="alert">Couldn't refresh: {error} <button type="button" className="a-link" onClick={reload}>Retry</button></div>}
      <Freshness d={d} />
      <div className="a-stats" style={{ opacity: loading ? 0.6 : 1 }}>
        <Stat icon="card" label="Net revenue" value={d.totals.revenue.netDisplay} note={`${d.totals.revenue.payments} payments · ${rupees(d.totals.revenue.refundedPaise)} refunded`} />
        <Stat icon="users" label="New users" value={compact(d.totals.newUsers)} note={`${d.totals.users.toLocaleString("en-IN")} total`} />
        <Stat icon="star" label="Active subscribers" value={compact(d.totals.activeSubscribers)} note={`${d.totals.newSubscriptions} new purchases`} />
        <Stat icon="play" label="Playback starts" value={compact(d.totals.playbackStarts)} note={`${d.totals.uniqueViewers} viewers · ${d.totals.watchHours} watch hrs`} />
      </div>
      {d.totals.failedPayments > 0 && <div className="a-error" role="status">{d.totals.failedPayments} failed payment{d.totals.failedPayments === 1 ? "" : "s"} in this range.</div>}
      <div className="a-grid-2">
        <Panel eyebrow="TREND" title={metric === "revenue" ? "Revenue (gross)" : metric === "users" ? "New users" : "Playback starts"} action={<div className="a-tabs small">{([["revenue", "Revenue"], ["users", "New users"], ["plays", "Plays"]] as const).map(([k, l]) => <button type="button" key={k} className={metric === k ? "active" : ""} onClick={() => setMetric(k)}>{l}</button>)}</div>}>
          {hasData ? <AreaChart values={series.map((p) => (metric === "revenue" ? p.value / 100 : p.value))} labels={series.map((p) => shortDay(p.date))} format={metric === "revenue" ? (n) => rupees(Math.round(n * 100)) : fmt} /> : <Empty icon="chart" title="No activity yet" text="Nothing recorded in this range." />}
        </Panel>
        <Panel eyebrow="SHORTCUTS" title="Quick links">
          <ul className="a-feed">{links.map((l) => <li key={l.key}><span><button type="button" className="a-link" onClick={() => go(l.key)}>{l.label} <Icon name="arrow" size={14} /></button></span></li>)}</ul>
        </Panel>
      </div>
      <Panel flush eyebrow="CONTENT PULSE" title="Top series by playback starts" action={can("catalog.read") ? <button type="button" className="a-link" onClick={() => go("series")}>All series <Icon name="arrow" size={14} /></button> : undefined}>
        {d.topSeries.length ? <div className="a-table-wrap"><table className="a-table"><thead><tr><th>Series</th><th>Starts</th><th>Viewers</th></tr></thead><tbody>
          {d.topSeries.map((s) => <tr key={s.id} className={can("catalog.read") ? "clickable" : ""} onClick={() => can("catalog.read") && go(`series/${s.id}/edit`)}><td><b>{s.title}</b></td><td>{s.playbackStarts.toLocaleString("en-IN")}</td><td>{s.uniqueViewers.toLocaleString("en-IN")}</td></tr>)}
        </tbody></table></div> : <Empty icon="play" title="No playback yet" text="Series appear here once viewers start watching." />}
      </Panel>
    </>}
  </div>;
}
