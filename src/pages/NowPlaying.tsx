import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowDownCircle, CheckCircle2, ChevronDown, ChevronLeft, MonitorPlay, MonitorSpeaker, PlusCircle, Heart, Loader2, ListMusic, MessageSquareQuote, Mic2, MoreHorizontal, Pause, Play, Plus, Repeat, Repeat1, Share2, Shuffle, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AddToPlaylistDialog } from "@/components/AddToPlaylistDialog";
import { ShareSheet } from "@/components/ShareSheet";
import { getCachedYouTubeId, getGlobalVolume, seekGlobalAudio, setGlobalVolume } from "@/components/player/GlobalAudioPlayer";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { usePlayer } from "@/context/PlayerContext";
import { cn } from "@/lib/utils";
import { SyncedVideoPanel } from "@/components/nowplaying/SyncedVideoPanel";
import { VideoCanvas } from "@/components/nowplaying/VideoCanvas";
import { LyricsStream, parseSyncedLyrics } from "@/components/nowplaying/LyricsStream";
import { useQuery } from "@tanstack/react-query";
import { fetchLyrics } from "@/services/lyricsLookup";
import { lookupMeta, peekMeta, type DeezerMeta } from "@/services/metadataEnrichment";

import { toTitleCase } from "@/utils/toTitleCase";
import { getDominantColor, gradientFromRGB } from "@/utils/dominantColor";

/** Progress ring geometry (viewBox is 100x100). */
const RING_R = 47;
const RING_C = 2 * Math.PI * RING_R;

function formatTime(seconds: number): string {
  if (!seconds || seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}


export default function NowPlaying() {
  const navigate = useNavigate();
  const { currentTrack, duration, isPlaying, next, nextTrack, previous, progress, queue, repeat, seek, shuffle, togglePlay, toggleRepeat, toggleShuffle } = usePlayer();
  const [liked, setLiked] = useState(false);
  const [localProgress, setLocalProgress] = useState(progress);
  const [showMore, setShowMore] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [showPlaylistDialog, setShowPlaylistDialog] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "downloading" | "done" | "failed">("idle");
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [showVideo, setShowVideo] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [videoActive, setVideoActive] = useState(false);
  // Artwork is the default; the background video only plays after "Switch to video".
  const [canvasOn, setCanvasOn] = useState(() => localStorage.getItem("routenet_canvas_on") === "1");
  const toggleCanvas = (on: boolean) => { localStorage.setItem("routenet_canvas_on", on ? "1" : "0"); setCanvasOn(on); };
  const showCanvas = canvasOn && videoActive;
  const [volume, setVolume] = useState(() => getGlobalVolume());
  /** Deezer metadata for the current song (title / artist / album / hi-res art). */
  const [meta, setMeta] = useState<DeezerMeta | null>(null);

  useEffect(() => setLocalProgress(progress), [progress]);
  // Re-apply the saved volume whenever the playback backend swaps tracks.
  useEffect(() => { setGlobalVolume(volume); }, [currentTrack?.id, volume]);
  // Snap the ring back to zero the instant the user skips forward/back.
  useEffect(() => setLocalProgress(0), [currentTrack?.id]);

  // Back works even when there is no history (direct open / refresh).
  const goBack = useCallback(() => {
    // Go to the last page the listener was on before opening the player.
    const last = sessionStorage.getItem("routenet_last_page");
    navigate(last && last !== "/now-playing" ? last : "/home");
  }, [navigate]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") goBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);

  // Now Playing shows Deezer metadata when it resolves; YouTube data is the fallback.
  useEffect(() => {
    if (!currentTrack) { setMeta(null); return; }
    let alive = true;
    setMeta(peekMeta(currentTrack.title, currentTrack.artist) ?? null);
    lookupMeta(currentTrack.title, currentTrack.artist)
      .then((m) => { if (alive) setMeta(m); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [currentTrack?.title, currentTrack?.artist]);

  const display = useMemo(() => ({
    title: meta?.title || currentTrack?.title || "",
    artist: meta?.artist || currentTrack?.artist || "",
    album: meta?.album || currentTrack?.album || "",
    artwork: meta?.artwork || currentTrack?.artwork || "",
  }), [meta, currentTrack]);

  // Plain colour backdrop derived from the cover — no artwork image behind the page.
  const [bgColor, setBgColor] = useState("linear-gradient(180deg, #2a2030 0%, #14121a 45%, #0a0a0a 100%)");
  useEffect(() => {
    let alive = true;
    const art = display.artwork;
    if (!art) return;
    getDominantColor(art).then((c) => { if (alive) setBgColor(gradientFromRGB(c)); }).catch(() => undefined);
    return () => { alive = false; };
  }, [display.artwork]);



  useEffect(() => {
    const compute = () => {
      if (!currentTrack) {
        setLiked(false);
        return;
      }
      try {
        const likedSongs = JSON.parse(localStorage.getItem("tunestream_liked_songs") || "[]");
        setLiked(likedSongs.some((song: any) => song.title === currentTrack.title && song.artist === currentTrack.artist));
      } catch {
        setLiked(false);
      }
    };
    compute();
    window.addEventListener("liked-updated", compute);
    return () => window.removeEventListener("liked-updated", compute);
  }, [currentTrack?.artist, currentTrack?.title]);

  const isResolving = useMemo(() => !!currentTrack && !currentTrack.youtubeId && !getCachedYouTubeId(currentTrack.title, currentTrack.artist), [currentTrack]);
  const videoId = useMemo(
    () => currentTrack?.youtubeId || getCachedYouTubeId(currentTrack?.title || "", currentTrack?.artist || "") || "",
    [currentTrack],
  );
  const actualDuration = duration || currentTrack?.duration || 0;
  const currentTime = Math.floor(localProgress * actualDuration);

  const handleSeek = useCallback((newProgress: number) => {
    seek(newProgress);
    setLocalProgress(newProgress);
    if (actualDuration > 0) seekGlobalAudio(newProgress * actualDuration);
  }, [actualDuration, seek]);

  const handleToggleLike = useCallback(() => {
    if (!currentTrack) return;
    import("@/pages/Library").then(({ toggleLikedSong }) => setLiked(toggleLikedSong(currentTrack)));
  }, [currentTrack]);

  const handleDownload = useCallback(async () => {
    if (!currentTrack || downloadStatus === "downloading") return;
    setDownloadStatus("downloading");
    setDownloadPercent(0);
    const mod = await import("@/services/downloadService");
    const ok = await mod.downloadTrack(currentTrack, (p) => setDownloadPercent(p));
    setDownloadStatus(ok ? "done" : "failed");
    if (ok) toast.success("Downloaded to offline library");
    else toast.error(mod.lastDownloadError || "Download failed");
  }, [currentTrack, downloadStatus]);

  if (!currentTrack) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <div>
          <p className="text-lg font-extrabold text-foreground">No track playing</p>
          <Button onClick={() => navigate("/")} className="mt-4 rounded-full">Go Home</Button>
        </div>
      </main>
    );
  }

  return (
    <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-20 flex h-[100dvh] flex-col overflow-hidden overscroll-none bg-background text-foreground">
      <AnimatePresence mode="wait">
        <motion.div
          key={bgColor}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="pointer-events-none absolute inset-0"
          style={{ background: bgColor }}
        />
      </AnimatePresence>
      <VideoCanvas trackId={currentTrack.id} artwork={display.artwork} artist={currentTrack.artist} title={currentTrack.title} enabled={canvasOn} onActiveChange={setVideoActive} />

      {/* Desktop: back button, top-left */}
      <button onClick={goBack} aria-label="Back" title="Back (Esc)" className="absolute left-6 top-6 z-[60] hidden h-10 w-10 pointer-events-auto items-center justify-center rounded-full bg-background/50 text-foreground backdrop-blur-md transition-transform hover:scale-105 hover:bg-background/70 lg:flex">
        <ChevronLeft className="h-5 w-5" />
      </button>

      {/* Desktop: Artwork / Video switch */}
      <div className="absolute left-1/2 top-6 z-20 hidden -translate-x-1/2 rounded-full bg-background/40 p-1 backdrop-blur-md lg:flex">
        {([["Artwork", false], ["Video", true]] as const).map(([label, on]) => (
          <button key={label} onClick={() => toggleCanvas(on)} aria-pressed={canvasOn === on}
            className={cn("rounded-full px-4 py-1.5 text-xs font-bold transition-colors", canvasOn === on ? "bg-foreground text-background" : "text-foreground/70 hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>

      {/* Desktop: bent artwork left, rolling lyrics right */}
      <div className="relative z-10 hidden min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-12 px-14 pb-28 pt-10 lg:grid">
        <div className="flex min-h-0 flex-col justify-center [perspective:1200px]">
          <motion.div
            animate={showCanvas ? { x: -140, opacity: 0, scale: 0.9, filter: "blur(6px)" } : { x: 0, opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ type: "spring", stiffness: 70, damping: 20, mass: 1 }}
            className={cn("relative flex w-full max-w-[min(34vw,58vh)] flex-col items-center", showCanvas && "pointer-events-none")}>
            <div className="pointer-events-none absolute -inset-16 rounded-full bg-primary/20 blur-[90px]" />
            <motion.div
              key={currentTrack.id}
              initial={{ opacity: 0, y: 30, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 110, damping: 18 }}
              className="rn-suspend relative z-10 aspect-square w-full overflow-hidden rounded-xl shadow-[0_0_60px_-10px_hsl(var(--foreground)/0.35),0_60px_80px_-40px_hsl(0_0%_0%/0.9)]"
            >
              <img src={display.artwork} alt={display.title} className="h-full w-full object-cover" />
            </motion.div>
            {/* light beam holding the cover in the air */}
            <div className="pointer-events-none mt-2 h-24 w-1/2 bg-gradient-to-b from-foreground/25 to-transparent blur-md [clip-path:polygon(20%_0,80%_0,55%_100%,45%_100%)]" />
          </motion.div>
          <h1 className="mt-8 truncate text-3xl font-bold text-foreground">{toTitleCase(display.title)}</h1>
          <button onClick={() => navigate(`/artist/${encodeURIComponent(display.artist)}`)} className="truncate text-left text-lg text-foreground/60 hover:text-foreground">
            {toTitleCase(display.artist)}
          </button>
        </div>
        <LyricsStream
          title={currentTrack.title}
          artist={currentTrack.artist}
          album={display.album}
          currentTime={currentTime}
          onSeek={(t) => actualDuration > 0 && handleSeek(t / actualDuration)}
        />
      </div>

      {/* Phone: frosted player — artwork card, info row, pills, controls, bottom toolbar */}
      {!showCanvas && (
        <div className="pointer-events-none absolute inset-0 lg:hidden">
          <img src={display.artwork} alt="" className="h-full w-full scale-125 object-cover opacity-50 blur-3xl" />
          <div className="absolute inset-0 bg-background/40" />
        </div>
      )}
      <header className="relative z-10 flex shrink-0 items-center justify-between px-5 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:hidden">
        <button onClick={goBack} aria-label="Back" className="relative z-[60] min-w-0 text-left">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground/70">
            <ChevronDown className="h-4 w-4 shrink-0" />
            <span className="truncate">{toTitleCase(display.album || display.artist)}</span>
          </span>
          <span className="block truncate pl-5 text-[12px] font-bold text-foreground">Now playing</span>
        </button>
        <div className="flex items-center gap-5">
          <button onClick={() => toggleCanvas(!canvasOn)} aria-label={canvasOn ? "Switch to artwork" : "Switch to video"} className={cn("text-foreground", canvasOn && "text-primary")}>
            <MonitorPlay className="h-5 w-5" />
          </button>
          <button onClick={() => setShowVolume((v) => !v)} aria-label="Device and volume" className="text-foreground">
            <MonitorSpeaker className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-6 pb-4 lg:hidden">
        <div className="flex min-h-0 flex-1 items-center justify-center pb-2 pt-1">
          {!showCanvas ? (
            <motion.div
              key={currentTrack.id}
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="aspect-square w-full max-w-[min(78vw,38dvh)] overflow-hidden rounded-xl shadow-[0_24px_60px_-14px_hsl(0_0%_0%/0.75)]"
            >
              {isResolving ? (
                <div className="flex h-full w-full items-center justify-center bg-secondary"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
              ) : (
                <img src={display.artwork} alt={display.title} className="h-full w-full object-cover" />
              )}
            </motion.div>
          ) : (
            <div className="flex h-full w-full items-end">
              <PhoneLyricLine title={currentTrack.title} artist={currentTrack.artist} currentTime={currentTime} onOpen={() => navigate("/lyrics")} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-bold leading-tight text-foreground">{toTitleCase(display.title)}</h1>
            <button onClick={() => navigate(`/artist/${encodeURIComponent(display.artist)}`)} className="mt-0.5 block max-w-full truncate text-[14px] text-foreground/60">
              {toTitleCase(display.artist)}
            </button>
          </div>
          <button onClick={handleToggleLike} aria-label="Like" className={cn("flex h-11 w-11 items-center justify-center rounded-full bg-foreground/10 text-foreground backdrop-blur-md", liked && "text-primary")}>
            <Heart className="h-5 w-5" fill={liked ? "currentColor" : "none"} />
          </button>
          <button onClick={() => setShowMore(true)} aria-label="More" className="flex h-11 w-11 items-center justify-center rounded-full bg-foreground/10 text-foreground backdrop-blur-md">
            <MoreHorizontal className="h-5 w-5 rotate-90" />
          </button>
        </div>

        <div className="mt-5">
          <Slider
            value={[localProgress * 100]}
            max={100}
            step={0.05}
            aria-label="Seek"
            onValueChange={([value]) => handleSeek(value / 100)}
            className="py-1 [&_[role=slider]]:h-3 [&_[role=slider]]:w-1.5 [&_[role=slider]]:rounded-sm [&_[role=slider]]:border-0 [&_[role=slider]]:bg-foreground [&>span]:h-[3px]"
          />
          <div className="mt-2 flex items-center justify-between text-[11px] font-semibold tabular-nums text-foreground/70">
            <span className="rounded-md bg-foreground/10 px-2 py-1">{formatTime(currentTime)}</span>
            <span className="rounded-md bg-foreground/10 px-2.5 py-1 text-[10px]">● High quality</span>
            <span className="rounded-md bg-foreground/10 px-2 py-1">-{formatTime(Math.max(0, actualDuration - currentTime))}</span>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between px-1">
          <button onClick={toggleShuffle} aria-pressed={shuffle} aria-label="Shuffle" className={cn("text-foreground/80", shuffle && "text-primary")}>
            <Shuffle className="h-5 w-5" />
          </button>
          <button onClick={previous} aria-label="Previous track" className="text-foreground active:scale-95">
            <SkipBack className="h-6 w-6" />
          </button>
          <button
            onClick={togglePlay}
            disabled={isResolving}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="flex h-16 w-16 items-center justify-center text-foreground active:scale-95 disabled:opacity-60"
          >
            {isResolving ? <Loader2 className="h-9 w-9 animate-spin" /> : isPlaying ? <Pause className="h-12 w-12" strokeWidth={1.5} /> : <Play className="ml-1 h-12 w-12" strokeWidth={1.5} />}
          </button>
          <button onClick={next} aria-label="Next track" className="text-foreground active:scale-95">
            <SkipForward className="h-6 w-6" />
          </button>
          <button onClick={toggleRepeat} aria-label={`Repeat: ${repeat}`} className={cn("text-foreground/80", repeat !== "off" && "text-primary")}>
            {repeat === "one" ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
          </button>
        </div>

        {showVolume && (
          <div className="mt-4 flex items-center gap-3">
            <Volume2 className="h-4 w-4 shrink-0 text-foreground/60" />
            <Slider value={[volume * 100]} max={100} step={1} aria-label="Volume" onValueChange={([value]) => { setVolume(value / 100); setGlobalVolume(value / 100); }} className="flex-1 [&_[role=slider]]:h-2.5 [&_[role=slider]]:w-2.5 [&_[role=slider]]:border-0 [&>span]:h-[3px]" />
          </div>
        )}
      </div>

      <section className="relative z-10 flex shrink-0 items-center justify-around px-6 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5 lg:hidden">
        <button onClick={() => navigate("/queue")} aria-label="Queue" className="text-foreground/80"><ListMusic className="h-5 w-5" /></button>
        <button onClick={() => toggleCanvas(!canvasOn)} aria-label="Video" className={cn("text-foreground/80", canvasOn && "text-primary")}><MonitorPlay className="h-5 w-5" /></button>
        <button onClick={() => navigate("/lyrics")} aria-label="Lyrics" className="text-foreground/80"><Mic2 className="h-5 w-5" /></button>
        <button onClick={() => setShowShareSheet(true)} aria-label="Share" className="text-foreground/80"><Share2 className="h-5 w-5" /></button>
      </section>

      <AnimatePresence>
        {showMore && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm" onClick={() => setShowMore(false)} />
            <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-4 shadow-elevated">
              <div className="mb-4 flex items-center gap-3">
                <img src={currentTrack.artwork} alt={currentTrack.title} className="h-12 w-12 rounded-lg object-cover" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-foreground">{toTitleCase(currentTrack.title)}</p>
                  <p className="truncate text-xs font-semibold text-muted-foreground">{toTitleCase(currentTrack.artist)}</p>
                </div>
              </div>
              <div className="grid gap-2">
                {[
                  { icon: Heart, label: liked ? "Remove from Liked Songs" : "Add to Liked Songs", action: handleToggleLike },
                  { icon: Plus, label: "Add to playlist", action: () => setShowPlaylistDialog(true) },
                  { icon: ListMusic, label: "Go to queue", action: () => navigate("/queue") },
                  { icon: Mic2, label: "View artist", action: () => navigate(`/artist/${encodeURIComponent(display.artist)}`) },
                  { icon: MessageSquareQuote, label: "Show lyrics", action: () => navigate("/lyrics") },
                  { icon: MonitorPlay, label: canvasOn ? "Switch to artwork" : "Switch to video", action: () => toggleCanvas(!canvasOn) },
                  { icon: Volume2, label: "Sleep timer", action: () => navigate("/sleep-timer") },
                  { icon: ArrowDownCircle, label: downloadStatus === "done" ? "Downloaded" : "Download", action: handleDownload },
                  { icon: Share2, label: "Share", action: () => setShowShareSheet(true) },
                ].map(({ icon: Icon, label, action }) => (
                  <Button key={label} variant="ghost" onClick={() => { action(); setShowMore(false); }} className="justify-start rounded-xl px-3 text-sm font-bold">
                    <Icon className="h-4 w-4 text-primary" />{label}
                  </Button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showVideo && videoId && (
          <SyncedVideoPanel
            videoId={videoId}
            title={display.title}
            startSeconds={currentTime}
            onClose={() => setShowVideo(false)}
          />
        )}
      </AnimatePresence>

      <ShareSheet isOpen={showShareSheet} onClose={() => setShowShareSheet(false)} item={{ type: "track", title: currentTrack.title, subtitle: currentTrack.artist, image: currentTrack.artwork, id: currentTrack.id }} />
      <AddToPlaylistDialog isOpen={showPlaylistDialog} onClose={() => setShowPlaylistDialog(false)} track={{ title: currentTrack.title, artist: currentTrack.artist, album: currentTrack.album, artwork: currentTrack.artwork, duration: currentTrack.duration }} />
    </motion.main>
  );
}


/** One synced lyric line shown above the song title on phones. */
function PhoneLyricLine({ title, artist, currentTime, onOpen }: { title: string; artist: string; currentTime: number; onOpen: () => void }) {
  const { data } = useQuery({
    queryKey: ["lyrics", title, artist],
    queryFn: () => fetchLyrics(title, artist),
    enabled: !!title && !!artist,
    staleTime: 30 * 60 * 1000,
  });
  const lines = useMemo(() => (data?.syncedLyrics ? parseSyncedLyrics(data.syncedLyrics) : []), [data?.syncedLyrics]);
  let text = "";
  for (const l of lines) { if (l.time <= currentTime) text = l.text; else break; }
  if (!text && lines.length) text = lines[0].text;
  if (!text) return null;
  return (
    <button onClick={onOpen} className="mb-2 text-left text-[19px] font-bold leading-snug text-foreground [text-shadow:0_2px_12px_hsl(0_0%_0%/0.6)]">
      <motion.span key={text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="line-clamp-2">{text}</motion.span>
    </button>
  );
}
