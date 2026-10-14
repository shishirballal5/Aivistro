import type { EpisodeItem } from "../api/viewer";
import { Icon } from "../shared";

/** Episode chips. Lock state comes from the SERVER's access decision per episode, never from a client-side rule. */
export default function EpisodeGrid({ episodes, current, onPick }: { episodes: EpisodeItem[]; current?: number; onPick: (n: number) => void }) {
  return <div className="episode-grid">{episodes.map((e) => {
    const locked = !e.access.allowed;
    return <button type="button" key={e.id} className={`ep-chip ${e.number === current ? "current" : ""} ${locked ? "locked" : ""}`} aria-label={`Episode ${e.number}${locked ? ", subscription required" : ""}`} onClick={() => onPick(e.number)}>{e.number}{locked && <Icon name="lock" size={10} />}</button>;
  })}</div>;
}
