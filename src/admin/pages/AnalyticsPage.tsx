import { useState } from "react";
import { Button, useToast } from "../../shared";
import { DASHBOARD_DAYS, getDashboard, type DashboardDays } from "../../api/admin-insights";
import { useAsync } from "../hooks";
import { AreaChart, Empty, PageHead, Panel, RangeTabs, Stat, downloadFile, toCsv } from "../ui";
import { ErrorBox, Freshness, rupees, shortDay } from "./DashboardParts";

export default function AnalyticsPage() {
  const notify = useToast();
  const [days, setDays] = useState<DashboardDays>(90);
  const { data: d, error, loading, reload } = useAsync(() => getDashboard(days), [days]);

  const exportCsv = () => {
    if (!d) return;
    const rows: (string | number)[][] = [["date (UTC)", "revenue_inr", "revenue_paise", "new_users", "playback_starts"]];
    d.daily.revenuePaise.forEach((r, i) => rows.push([r.date, (r.value / 100).toFixed(2), r.value, d.daily.newUsers[i]?.value ?? 0, d.daily.playbackStarts[i]?.value ?? 0]));
    downloadFile(`aivistro-daily-${d.rangeDays}d.csv`, toCsv(rows));
    notify("CSV downloaded");
  };

  const chart = (title: string, eyebrow: string, pts: { date: string; value: number }[], money: boolean, unit: string) => {
    const total = pts.reduce((a, p) => a + p.value, 0);
    return <Panel eyebrow={eyebrow} title={title} action={<span className="a-muted" style={{ fontSize: 12 }}>Total {money ? rupees(total) : total.toLocaleString("en-IN")}</span>}>
      {total > 0 ? <AreaChart values={pts.map((p) => (money ? p.value / 100 : p.value))} labels={pts.map((p) => shortDay(p.date))} format={money ? (n) => rupees(Math.round(n * 100)) : (n) => `${n.toLocaleString("en-IN")} ${unit}`} /> : <Empty icon="chart" title="No data" text={`No ${unit} in this range.`} />}
    </Panel>;
  };

  return <div className="a-page">
    <PageHead eyebrow="INSIGHTS" title="Analytics" sub="Daily breakdowns and exports. Overview lives on the Dashboard." actions={<><RangeTabs<DashboardDays> value={days} onChange={setDays} options={DASHBOARD_DAYS} /><Button className="primary" icon="download" onClick={exportCsv} disabled={!d}>Export daily CSV</Button></>} />
    {error && !d ? <ErrorBox message={error} onRetry={reload} /> : !d ? <div className="a-panel"><p className="a-muted" role="status">Loading analytics…</p></div> : <>
      {error && <div className="a-error" role="alert">Couldn't refresh: {error}</div>}
      <Freshness d={d} />
      <div className="a-stats" style={{ opacity: loading ? 0.6 : 1 }}>
        <Stat icon="card" label="Gross revenue" value={rupees(d.totals.revenue.grossPaise)} note={`${rupees(d.totals.revenue.refundedPaise)} refunded`} />
        <Stat icon="check" label="Successful payments" value={String(d.totals.revenue.payments)} note={`${d.totals.failedPayments} failed`} />
        <Stat icon="users" label="Unique viewers" value={String(d.totals.uniqueViewers)} note={`${d.totals.playbackStarts} starts`} />
        <Stat icon="play" label="Watch hours" value={String(d.totals.watchHours)} note="from watch progress" />
      </div>
      {chart("Revenue per day", "REVENUE", d.daily.revenuePaise, true, "revenue")}
      <div className="a-grid-2 even">
        {chart("New users per day", "AUDIENCE", d.daily.newUsers, false, "new users")}
        {chart("Playback starts per day", "ENGAGEMENT", d.daily.playbackStarts, false, "plays")}
      </div>
      <Panel flush eyebrow="DAILY TABLE" title="Day by day">
        <div className="a-table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}><table className="a-table"><thead><tr><th>Date (UTC)</th><th>Revenue</th><th>New users</th><th>Playback starts</th></tr></thead><tbody>
          {[...d.daily.revenuePaise].reverse().map((r, i, arr) => { const idx = arr.length - 1 - i; return <tr key={r.date}><td>{shortDay(r.date)}</td><td>{rupees(r.value)}</td><td>{d.daily.newUsers[idx]?.value ?? 0}</td><td>{d.daily.playbackStarts[idx]?.value ?? 0}</td></tr>; })}
        </tbody></table></div>
      </Panel>
      <Panel flush eyebrow="CONTENT" title="Top series">
        {d.topSeries.length ? <div className="a-table-wrap"><table className="a-table"><thead><tr><th>#</th><th>Series</th><th>Playback starts</th><th>Unique viewers</th></tr></thead><tbody>
          {d.topSeries.map((s, i) => <tr key={s.id}><td>{i + 1}</td><td><b>{s.title}</b></td><td>{s.playbackStarts}</td><td>{s.uniqueViewers}</td></tr>)}
        </tbody></table></div> : <Empty icon="play" title="No playback yet" />}
      </Panel>
    </>}
  </div>;
}
