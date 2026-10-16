import { useEffect, useState } from "react";
import { DECKS, getDeckStatus, type DeckStatus } from "@/components/player/GlobalAudioPlayer";
import { cn } from "@/lib/utils";

/** Shows the 4 rotating decks (A→B→C→D): live, fading out, and next up. */
export function DeckIndicator({ className }: { className?: string }) {
  const [s, setS] = useState<DeckStatus>(getDeckStatus());
  useEffect(() => {
    const h = (e: Event) => setS({ ...(e as CustomEvent<DeckStatus>).detail });
    window.addEventListener("deck-status", h);
    return () => window.removeEventListener("deck-status", h);
  }, []);
  const next = DECKS[(DECKS.indexOf(s.active) + 1) % DECKS.length];
  return (
    <div className={cn("flex items-center gap-1", className)} aria-label="Decks">
      {DECKS.map((d) => {
        const live = d === s.active;
        const fading = d === s.tail;
        const label = live ? (s.tail ? "Fading in" : "Live") : fading ? "Fading out" : d === next ? "Next" : "Standby";
        return (
          <span
            key={d}
            title={`Deck ${d} · ${label}`}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold transition-colors",
              live && "bg-primary text-primary-foreground",
              fading && "bg-accent text-accent-foreground animate-pulse",
              !live && !fading && d === next && "border border-primary/60 text-primary",
              !live && !fading && d !== next && "bg-muted text-muted-foreground",
            )}
          >
            {d}
          </span>
        );
      })}
    </div>
  );
}
