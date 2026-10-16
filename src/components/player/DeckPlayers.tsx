import { useEffect, useState } from "react";
import { Disc3 } from "lucide-react";
import { DECKS, getDeckStatus, type DeckStatus } from "@/components/player/GlobalAudioPlayer";
import { cn } from "@/lib/utils";

const LABEL = { live: "Playing", fading: "Finishing", ready: "Next up", idle: "Empty" } as const;

/** Four individual deck players (A, B, C, D), each with its own song. */
export function DeckPlayers() {
  const [s, setS] = useState<DeckStatus>(getDeckStatus());
  useEffect(() => {
    const h = (e: Event) => setS({ ...(e as CustomEvent<DeckStatus>).detail });
    window.addEventListener("deck-status", h);
    return () => window.removeEventListener("deck-status", h);
  }, []);
  const decks = s.decks;
  return (
    <div className="grid grid-cols-2 gap-2">
      {DECKS.map((d) => {
        const info = decks?.[d] ?? { state: "idle" as const };
        const live = info.state === "live";
        return (
          <div key={d} className={cn("rounded-md border p-3", live ? "border-primary bg-primary/10" : "border-border bg-muted/40")}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">Deck {d}</span>
              <Disc3 className={cn("h-4 w-4", live ? "animate-spin text-primary" : "text-muted-foreground")} />
            </div>
            <p className="truncate text-xs text-foreground">{info.title || "—"}</p>
            <p className={cn("text-[10px]", live ? "text-primary" : "text-muted-foreground")}>{LABEL[info.state]}</p>
          </div>
        );
      })}
    </div>
  );
}
