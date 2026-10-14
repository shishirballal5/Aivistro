import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ApiError } from "../api/http";
import { playbackApi, type EpisodeItem, type PlaybackSession } from "../api/viewer";
import { Button, formatTime, Icon, IconButton, useToast } from "../shared";
import EpisodeGrid from "./EpisodeGrid";
import { errorText, type Show } from "./model";

type Props = {
  show: Show; episodes: EpisodeItem[]; number: number; saved: boolean;
  onSave: () => void; onEpisode: (n: number) => void; onBack: () => void; onPaywall: () => void; onNeedAuth: () => void;
};
type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string; retry: boolean };

export default function Player({ show, episodes, number, saved, onSave, onEpisode, onBack, onPaywall, onNeedAuth }: Props) {
  const notify = useToast();
  const ep = episodes.find((e) => e.number === number);
  const video = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const position = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(ep?.durationSeconds ?? 0);
  const [muted, setMuted] = useState(false);
  const [hasCaptions, setHasCaptions] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [drawer, setDrawer] = useState(false);

  const hasNext = number < (episodes[episodes.length - 1]?.number ?? number);

  useEffect(() => {
    if (!ep) return;
    let cancelled = false;
    let session: PlaybackSession | null = null;
    let beat: number | undefined, progress: number | undefined;
    const v = video.current!;
    position.current = 0; setTime(0); setPhase({ kind: "loading" }); setPlaying(false); setHasCaptions(false);

    const fail = (e: unknown) => {
      if (cancelled) return;
      const code = e instanceof ApiError ? e.code : "";
      if (e instanceof ApiError && e.status === 401) return onNeedAuth();
      if (code === "SUBSCRIPTION_REQUIRED" || code === "SUBSCRIPTION_EXPIRED") return onPaywall();
      const message = code === "VIDEO_PROCESSING" ? "This episode is still being prepared. Please check back shortly." : code === "EPISODE_NOT_AVAILABLE" ? "This episode isn't available right now." : errorText(e, "We couldn't start playback.");
      setPhase({ kind: "error", message, retry: code !== "EPISODE_NOT_AVAILABLE" });
    };
    const saveProgress = () => { if (position.current > 0) void playbackApi.saveProgress(ep.id, position.current).catch(() => undefined); };

    (async () => {
      try {
        session = await playbackApi.start(ep.id); // the server re-checks the subscription here, whatever the UI showed
        if (cancelled) { void playbackApi.end(session.sessionId).catch(() => undefined); return; }
        if (session.endedOtherStreams) notify("Playback on another device was stopped.");
        const resume = await playbackApi.resume(ep.id).catch(() => null);
        const start = resume && !resume.completed && resume.positionSeconds > 5 ? resume.positionSeconds : 0;
        const url = session.manifestUrl;
        if (Hls.isSupported()) {
          const hls = new Hls({ startPosition: start || -1 });
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, () => { setHasCaptions(hls.subtitleTracks.length > 0); if (hls.subtitleTracks.length) hls.subtitleTrack = 0; });
          let retried = false;
          hls.on(Hls.Events.ERROR, (_e, d) => {
            if (!d.fatal || cancelled) return;
            if (d.type === Hls.ErrorTypes.NETWORK_ERROR && !retried) { retried = true; hls.startLoad(); return; }
            setPhase({ kind: "error", message: "Playback was interrupted.", retry: true });
          });
          hls.loadSource(url); hls.attachMedia(v);
        } else if (v.canPlayType("application/vnd.apple.mpegurl")) { // Safari plays HLS natively
          v.src = url;
          if (start) v.addEventListener("loadedmetadata", () => { v.currentTime = start; }, { once: true });
        } else throw new Error("This browser can't play AIVISTRO video.");
        setPhase({ kind: "ready" });
        void v.play().catch(() => setPlaying(false)); // autoplay can be blocked until the first tap
        const s = session;
        beat = window.setInterval(() => {
          playbackApi.heartbeat(s.sessionId, position.current).catch((e) => {
            if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) { v.pause(); setPhase({ kind: "error", message: "Your viewing session ended. Your subscription may have expired or you started playback elsewhere.", retry: true }); }
          });
        }, Math.max(10, s.heartbeatIntervalSeconds) * 1000);
        progress = window.setInterval(saveProgress, 15000);
      } catch (e) { fail(e); }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(beat); window.clearInterval(progress);
      saveProgress();
      if (session) void playbackApi.end(session.sessionId).catch(() => undefined);
      hlsRef.current?.destroy(); hlsRef.current = null;
      v.removeAttribute("src"); v.load();
    };
  }, [ep?.id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTime = useCallback(() => { const v = video.current; if (!v) return; position.current = v.currentTime; setTime(Math.floor(v.currentTime)); if (Number.isFinite(v.duration) && v.duration > 0) setLength(Math.floor(v.duration)); }, []);
  const onEnded = () => {
    if (ep) void playbackApi.saveProgress(ep.id, Math.floor(video.current?.duration ?? length)).catch(() => undefined); // marks it completed server-side
    setPlaying(false);
    if (hasNext) onEpisode(number + 1);
  };
  const toggle = () => { const v = video.current; if (!v || phase.kind !== "ready") return; if (v.paused) void v.play(); else v.pause(); };
  const seek = (t: number) => { const v = video.current; if (v) { v.currentTime = t; setTime(t); } };
  const toggleCaptions = () => { const h = hlsRef.current; if (!h) return; const on = !captions; h.subtitleTrack = on ? 0 : -1; setCaptions(on); };
  const share = async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/?series=${show.slug}`); notify("Link copied"); } catch { notify("Sharing isn't available in this browser"); } };
  const next = episodes.find((e) => e.number === number + 1);
  const nextLocked = !!next && !next.access.allowed;
  const total = episodes.length;

  if (!ep) return <div className="player-page"><div className="player-main"><div className="player-stage"><div className="player-status"><b>Episode not found</b><Button className="primary" onClick={onBack}>Back</Button></div></div></div></div>;
  return <div className="player-page">
    <div className="player-main">
      <div className="player-bg"><img src={show.image} alt="" /></div>
      <div className="player-stage">
        <video ref={video} className="player-frame" playsInline poster={ep.thumbnailUrl ?? undefined} muted={muted} onTimeUpdate={onTime} onLoadedMetadata={onTime} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={onEnded} />
        <div className="player-vignette" />
        <button type="button" className="tap-area" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>{phase.kind === "ready" && !playing && <span className="center-play"><Icon name="play" size={32} /></span>}</button>
        {phase.kind === "loading" && <div className="player-status" role="status"><span className="processing-ring" /><small>Preparing your episode…</small></div>}
        {phase.kind === "error" && <div className="player-status" role="alert"><b>{phase.message}</b>{phase.retry && <Button className="primary" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}<Button className="outline" onClick={onBack}>Back to episodes</Button></div>}
        <div className="player-top"><IconButton icon="back" label="Back" onClick={onBack} /><span><b>{show.title}</b><small>Episode {ep.number}{ep.title && ep.title !== `Episode ${ep.number}` ? ` · ${ep.title}` : ""}</small></span><IconButton icon="share" label="Share" onClick={share} /></div>
        <div className="player-social">
          <button type="button" aria-pressed={saved} className={saved ? "on" : ""} onClick={onSave}><span><Icon name="bookmark" /></span><small>{saved ? "Saved" : "Save"}</small></button>
          <button type="button" onClick={() => setDrawer(true)}><span><Icon name="series" /></span><small>Episodes</small></button>
        </div>
        <div className="player-story"><span className="episode-chip">EPISODE {ep.number} / {total}</span><div className="player-title">{ep.title}</div></div>
        <div className="player-controls">
          <input className="seek" type="range" min={0} max={Math.max(length, 1)} value={Math.min(time, Math.max(length, 1))} aria-label="Seek" style={{ "--pct": `${length ? (time / length) * 100 : 0}%` } as CSSProperties} onChange={(e) => seek(Number(e.target.value))} />
          <div className="control-row"><div><IconButton icon={playing ? "pause" : "play"} label={playing ? "Pause" : "Play"} onClick={toggle} /><IconButton icon={muted ? "mute" : "volume"} label={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)} /><span>{formatTime(time)} / {formatTime(length)}</span></div><div>{hasCaptions && <IconButton icon="captions" label={captions ? "Hide captions" : "Show captions"} onClick={toggleCaptions} />}{hasNext && <button type="button" className="next-pill" onClick={() => onEpisode(number + 1)}>Next <Icon name={nextLocked ? "lock" : "arrow"} size={14} /></button>}</div></div>
        </div>
      </div>
    </div>
    <aside className={`player-episodes ${drawer ? "open" : ""}`} aria-label="Episodes">
      <div className="player-episode-head"><div><span className="eyebrow">NOW WATCHING</span><h2 className="heading">{show.title}</h2></div><IconButton icon="close" label="Close episodes" onClick={() => setDrawer(false)} /></div>
      <EpisodeGrid episodes={episodes} current={number} onPick={(n) => { setDrawer(false); if (n !== number) onEpisode(n); }} />
      {hasNext && <Button className="primary wide" icon={nextLocked ? "lock" : "play"} onClick={() => { setDrawer(false); onEpisode(number + 1); }}>{nextLocked ? "Unlock Next Episode" : "Play Next Episode"}</Button>}
    </aside>
  </div>;
}
