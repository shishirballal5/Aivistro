import { useEffect, useState } from "react";
import { Icon } from "../../shared";
import { searchSeries, type SeriesHit } from "../../api/admin-insights";

/** Debounced series search against GET /admin/series?q=. Calls onPick with the chosen series. */
export function SeriesSearch({ onPick, placeholder = "Search series by title" }: { onPick: (s: SeriesHit) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SeriesHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits([]); setState("idle"); return; }
    let live = true;
    setState("loading");
    const t = window.setTimeout(() => { searchSeries(term).then((r) => { if (live) { setHits(r); setState("idle"); } }, () => { if (live) setState("error"); }); }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [q]);
  return <div className="hp-search">
    <label className="a-search"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>
    {q.trim() && <ul className="hp-hits">
      {state === "loading" && <li className="a-muted">Searching…</li>}
      {state === "error" && <li className="a-muted">Search failed. Try again.</li>}
      {state === "idle" && !hits.length && <li className="a-muted">No series match.</li>}
      {hits.map((h) => <li key={h.id}><button type="button" onClick={() => { onPick(h); setQ(""); }}><b>{h.title}</b><small>{h.status}</small></button></li>)}
    </ul>}
  </div>;
}
