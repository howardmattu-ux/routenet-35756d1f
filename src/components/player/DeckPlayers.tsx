import { useEffect, useRef, useState } from "react";
import { Disc3, Loader2 } from "lucide-react";
import { DECKS, getDeckStatus, getPlayerLoading, type DeckName, type DeckStatus } from "@/components/player/GlobalAudioPlayer";
import { cn } from "@/lib/utils";

type T = { t: number; d: number };
const fmt = (s: number) => (s > 0 && Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

function Bar({ time, loading, live }: { time: T | null; loading?: boolean; live?: boolean }) {
  const pct = time && time.d > 0 ? Math.min(100, (time.t / time.d) * 100) : 0;
  return (
    <div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        {loading ? (
          <div className="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-primary/60" style={{ left: "33%" }} />
        ) : (
          <div className={cn("h-full rounded-full", live ? "bg-primary" : "bg-muted-foreground")} style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{loading ? "Loading…" : fmt(time?.t ?? 0)}</span>
        <span>{fmt(time?.d ?? 0)}</span>
      </div>
    </div>
  );
}

/** Four individual deck players (A–D) plus a live mix view: finishing song on top, starting song below. */
export function DeckPlayers() {
  const [s, setS] = useState<DeckStatus>(getDeckStatus());
  const [loading, setLoading] = useState(getPlayerLoading());
  const [times, setTimes] = useState<{ live: T; tail: T | null }>({ live: { t: 0, d: 0 }, tail: null });
  const titles = useRef<Partial<Record<DeckName, string>>>({});

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

  DECKS.forEach((d) => { const t = s.decks?.[d]?.title; if (t) titles.current[d] = t; });
  const titleOf = (d: DeckName | null) => (d ? s.decks?.[d]?.title || titles.current[d] : undefined) || "—";
  const mixing = !!s.tail && s.tail !== s.active;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <p className="mb-2 text-xs font-semibold text-foreground">{mixing ? "Mixing" : "Now playing"}</p>
        {mixing && (
          <div className="mb-3">
            <p className="truncate text-xs text-foreground">Deck {s.tail} · {titleOf(s.tail)}</p>
            <Bar time={times.tail} />
          </div>
        )}
        <p className="truncate text-xs font-medium text-foreground">Deck {s.active} · {titleOf(s.active)}</p>
        <Bar time={times.live} loading={loading} live />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {DECKS.map((d) => {
          const info = s.decks?.[d] ?? { state: "idle" as const };
          const live = d === s.active;
          const tail = d === s.tail && !live;
          const label = live ? (loading ? "Loading" : "Playing") : tail ? "Finishing" : info.state === "ready" ? "Next up" : "Empty";
          return (
            <div key={d} className={cn("rounded-md border p-3", live ? "border-primary bg-primary/10" : "border-border bg-muted/40")}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">Deck {d}</span>
                {live && loading ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  : <Disc3 className={cn("h-4 w-4", live || tail ? "animate-spin text-primary" : "text-muted-foreground")} />}
              </div>
              <p className="truncate text-xs text-foreground">{live || tail || info.state === "ready" ? titleOf(d) : "—"}</p>
              <p className={cn("mb-1 text-[10px]", live ? "text-primary" : "text-muted-foreground")}>{label}</p>
              {(live || tail) && <Bar time={live ? times.live : times.tail} loading={live && loading} live={live} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
