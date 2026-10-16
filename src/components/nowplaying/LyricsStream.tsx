/** Synced lyrics that roll upward. Double-tap toggles auto-sync on/off. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Music2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchLyrics } from "@/services/lyricsLookup";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/context/PlayerContext";

interface LyricLine { time: number; text: string }

export function parseSyncedLyrics(synced: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(synced)) !== null) {
    const time = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100);
    if (m[4].trim()) lines.push({ time, text: m[4].trim() });
  }
  return lines;
}

/** Song-story lines shown when a song has no lyrics; they glide up and back down like synced lyrics. */
function storyLines(title: string, artist: string, album?: string): string[] {
  return [
    title,
    `by ${artist}`,
    album ? `From the album ${album}` : "Single release",
    "No lyrics found for this one",
    "Just feel the music",
    `Turn it up for ${artist.split(/,|&| feat| ft/i)[0].trim()}`,
    "Lyrics may land here soon",
  ].filter(Boolean);
}

export function LyricsStream({ title, artist, album, currentTime, className, onSeek }: {
  title: string; artist: string; album?: string; currentTime: number; className?: string; onSeek?: (t: number) => void;
}) {
  const activeRef = useRef<HTMLParagraphElement>(null);
  const [synced, setSynced] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["lyrics", title, artist],
    queryFn: () => fetchLyrics(title, artist),
    enabled: !!title && !!artist,
    staleTime: 30 * 60 * 1000,
  });

  const lines = useMemo(() => (data?.syncedLyrics ? parseSyncedLyrics(data.syncedLyrics) : null), [data?.syncedLyrics]);
  const hasSynced = !!lines && lines.length > 0;
  const plain = (data?.lyrics || "").split("\n").filter((l) => l.trim());
  const isStory = !isLoading && !hasSynced && plain.length === 0;
  const story = useMemo(() => storyLines(title, artist, album), [title, artist, album]);
  const { duration: playerDuration } = usePlayer();
  const isPlain = !hasSynced && plain.length > 0;
  const activeIndex = useMemo(() => {
    if (isStory) {
      // Ping-pong through the story every 5s: down, then back up.
      const n = story.length, cycle = Math.max(1, 2 * n - 2), step = Math.floor(currentTime / 5) % cycle;
      return step < n ? step : cycle - step;
    }
    if (isPlain) {
      // Unsynced lyrics: stretch the lines evenly across the song (skip a short intro/outro).
      const d = playerDuration > 0 ? playerDuration : 210;
      const start = d * 0.06, end = d * 0.94;
      const p = Math.min(1, Math.max(0, (currentTime - start) / (end - start)));
      return Math.min(plain.length - 1, Math.floor(p * plain.length));
    }
    if (!lines) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].time <= currentTime) idx = i; else break; }
    return idx;
  }, [lines, currentTime, isStory, story, isPlain, plain.length, playerDuration]);

  useEffect(() => {
    if (isPlain) return;
    if (synced && activeRef.current) activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex, synced, isPlain]);

  // Unsynced lyrics: the whole sheet glides down continuously with the song.
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollBoxRef.current;
    if (!isPlain || !synced || !el) return;
    const d = playerDuration > 0 ? playerDuration : 210;
    const p = Math.min(1, Math.max(0, currentTime / d));
    el.scrollTo({ top: p * (el.scrollHeight - el.clientHeight), behavior: "smooth" });
  }, [currentTime, isPlain, synced, playerDuration]);

  const toggleSync = () => {
    setSynced((s) => {
      setFlash(s ? "Sync off" : "Sync on");
      return !s;
    });
    window.setTimeout(() => setFlash(null), 1200);
  };

  const display = hasSynced ? lines! : isStory ? story.map((text, i) => ({ time: i, text })) : plain.map((text, i) => ({ time: i, text }));
  const highlight = hasSynced || isStory;

  return (
    <div onDoubleClick={toggleSync} className={cn("relative h-full min-h-0 select-none", className)}>
      {flash && (
        <span className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-foreground/15 px-3 py-1 text-xs font-semibold text-foreground backdrop-blur">{flash}</span>
      )}
      <div ref={scrollBoxRef} className="custom-scrollbar h-full overflow-y-auto pr-4 [mask-image:linear-gradient(to_bottom,transparent,black_15%,black_85%,transparent)]">
        {isLoading && <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {isStory && <p className="sticky top-0 flex items-center gap-2 pt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><Music2 className="h-4 w-4" /> Song story</p>}
        <div className="space-y-5 py-[30vh]">
          {display.map((line, i) => {
            const isActive = highlight && i === activeIndex;
            const isPast = highlight && i < activeIndex;
            return (
              <p
                key={i}
                ref={isActive ? activeRef : undefined}
                onClick={() => hasSynced && onSeek?.(line.time)}
                className={cn(
                  "cursor-pointer text-[28px] font-bold leading-[1.25] tracking-tight transition-all duration-500 xl:text-[34px]",
                  !highlight ? "text-foreground/85" : isActive ? "text-foreground" : isPast ? "text-foreground/30" : "text-foreground/55",
                )}
              >
                {line.text}
              </p>
            );
          })}
        </div>
      </div>
      <p className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-muted-foreground">Double-tap to turn sync {synced ? "off" : "on"}</p>
    </div>
  );
}
