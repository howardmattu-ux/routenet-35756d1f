import { useEffect, useState } from "react";
import { Disc3, Loader2 } from "lucide-react";
import { getDeckStatus, getPlayerLoading, type DeckStatus } from "@/components/player/GlobalAudioPlayer";
import { usePlayer } from "@/context/PlayerContext";
import { cn } from "@/lib/utils";

type T = { t: number; d: number };
const fmt = (s: number) => (s > 0 && Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

function Bar({ time, loading }: { time: T | null; loading?: boolean }) {
  const pct = time && time.d > 0 ? Math.min(100, (time.t / time.d) * 100) : 0;
  return (
    <div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        {loading ? (
          <div className="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-primary/60" style={{ left: "33%" }} />
        ) : (
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{loading ? "Loading…" : fmt(time?.t ?? 0)}</span>
        <span>{fmt(time?.d ?? 0)}</span>
      </div>
    </div>
  );
}

/**
 * Numbered players (1, 2, 3 … one per queue song). Players stay in song order,
 * so when the next song starts the finishing one keeps its place — no switch.
 */
export function DeckPlayers() {
  const { queue, currentTrack } = usePlayer();
  const [s, setS] = useState<DeckStatus>(getDeckStatus());
  const [loading, setLoading] = useState(getPlayerLoading());
  const [times, setTimes] = useState<{ live: T; tail: T | null }>({ live: { t: 0, d: 0 }, tail: null });

  useEffect(() => {
    const h = (e: Event) => setS({ ...(e as CustomEvent<DeckStatus>).detail });
    const l = (e: Event) => setLoading(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener("deck-status", h);
    window.addEventListener("player-loading", l);
    const iv = setInterval(() => {
      const f = (window as any).__deckTimes;
      if (f) try { setTimes(f()); } catch { /* ignore */ }
    }, 500);
    return () => { window.removeEventListener("deck-status", h); window.removeEventListener("player-loading", l); clearInterval(iv); };
  }, []);

  const idx = queue.findIndex((t) => t.id === currentTrack?.id);
  const overlap = !!s.tail && s.tail !== s.active && idx > 0;
  const rows: { n: number; title: string; time: T | null; loading?: boolean; on: boolean; label: string }[] = [];
  // Previous player always stays in place (finishing, then "Played").
  if (idx > 0) {
    const prev = queue[idx - 1];
    const d = prev?.duration || 0;
    rows.push({ n: idx, title: prev?.title ?? "—", time: overlap ? times.tail : { t: d, d }, on: overlap, label: overlap ? "Finishing" : "Played" });
  }
  if (idx >= 0) rows.push({ n: idx + 1, title: queue[idx].title, time: times.live, loading, on: true, label: "Playing" });
  if (idx >= 0 && queue[idx + 1]) rows.push({ n: idx + 2, title: queue[idx + 1].title, time: null, on: false, label: "Next up" });

  if (!rows.length) return <p className="text-xs text-muted-foreground">Play a song to see the players.</p>;

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.n} className={cn("rounded-md border p-3", r.on ? "border-primary bg-primary/10" : "border-border bg-muted/40")}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-bold text-foreground">Player {r.n}</span>
            {r.loading ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
              : <Disc3 className={cn("h-4 w-4", r.on ? "animate-spin text-primary" : "text-muted-foreground")} />}
          </div>
          <p className="truncate text-xs text-foreground">{r.title}</p>
          <p className={cn("mb-1 text-[10px]", r.on ? "text-primary" : "text-muted-foreground")}>{r.label}</p>
          {r.time && <Bar time={r.time} loading={r.loading} />}
        </div>
      ))}
    </div>
  );
}
