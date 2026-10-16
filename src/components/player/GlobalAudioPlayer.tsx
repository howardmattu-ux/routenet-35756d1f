import { useEffect, useRef, useCallback, useState } from "react";
import { getCrossfade } from "@/lib/crossfadePrefs";
import { usePlayer } from "@/context/PlayerContext";
import { YouTubePlayer, YouTubePlayerRef, preloadYouTubeAPI } from "./YouTubePlayer";
import { searchYouTubeForTrack } from "@/hooks/useYouTubePlayback";
import { Track } from "@/data/mockData";
import { toast } from "@/hooks/use-toast";
import { startBackgroundKeepAlive, stopBackgroundKeepAlive } from "@/lib/mediaUnlock";
import { getPipedAudioUrl, shouldUseIframe, markAsIframeOnly } from "@/services/pipedAudio";
import { getSong, isDownloadedSync, syncDownloadIndex } from "@/services/indexedDBService";

import {
  isNativeAudioPluginAvailable,
  preloadNativeAudio,
  playNativeAudio,
  resumeNativeAudio,
  pauseNativeAudio,
  stopNativeAudio,
  getNativeAudioCurrentTime,
  startAppForegroundService,
} from "@/services/nativeAudioPlayer";

const youtubeIdCache = new Map<string, string>();

// Crossfade settings: 12s overlap. The outgoing track keeps playing to
// its natural end while the incoming track fades in over the same window
// so two songs literally play simultaneously during the handover.
// Only active when AutoMix is explicitly enabled — otherwise tracks play
// in full with a hard cut between them (no fade, no truncation).
const CROSSFADE_FADE_INTERVAL_MS = 100;
// Volume fading in/out caused songs to freeze — kept off.
const FADING_DISABLED = true;
function xfMs() { return getCrossfade().seconds * 1000; }
function isAutoMixEnabled(): boolean { return getCrossfade().enabled; }
// Equal-power curves so the overlap sounds smooth (no volume dip mid-fade).
const fadeOutCurve = (t: number) => Math.cos(t * Math.PI / 2);
const fadeInCurve = (t: number) => Math.sin(t * Math.PI / 2);

function getCacheKey(title: string, artist: string): string {
  return `${title.toLowerCase().trim()}|${artist.toLowerCase().trim()}`;
}

export function cacheYouTubeId(title: string, artist: string, videoId: string) {
  youtubeIdCache.set(getCacheKey(title, artist), videoId);
}

export function getCachedYouTubeId(title: string, artist: string): string | undefined {
  return youtubeIdCache.get(getCacheKey(title, artist));
}

const preloadingSet = new Set<string>();

async function preloadNextTracks(queue: Track[], currentTrackId: string | undefined) {
  if (!currentTrackId || queue.length === 0) return;
  const currentIndex = queue.findIndex(t => t.id === currentTrackId);
  if (currentIndex === -1) return;

  const upcoming = queue.slice(currentIndex + 1, currentIndex + 4);
  const toPreload = upcoming.filter(track => {
    const key = getCacheKey(track.title, track.artist);
    return !youtubeIdCache.has(key) && !track.youtubeId && !preloadingSet.has(key);
  });

  await Promise.allSettled(
    toPreload.map(async (track) => {
      const key = getCacheKey(track.title, track.artist);
      preloadingSet.add(key);
      try {
        const id = await searchYouTubeForTrack(track);
        if (id) {
          cacheYouTubeId(track.title, track.artist, id);
          track.youtubeId = id;
        }
      } catch {} finally {
        preloadingSet.delete(key);
      }
    })
  );
}

let hasProactivelyCached = false;
function proactiveCacheLikedSongs() {
  if (hasProactivelyCached) return;
  hasProactivelyCached = true;
  try {
    const liked = JSON.parse(localStorage.getItem("tunestream_liked_songs") || "[]");
    const uncached = liked.filter((s: any) => !getCachedYouTubeId(s.title, s.artist)).slice(0, 10);
    if (uncached.length === 0) return;
    const schedule = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 3000));
    schedule(() => {
      Promise.allSettled(
        uncached.map(async (s: any) => {
          const key = getCacheKey(s.title, s.artist);
          if (preloadingSet.has(key)) return;
          preloadingSet.add(key);
          try {
            const id = await searchYouTubeForTrack({ id: s.id, title: s.title, artist: s.artist, album: s.album || "", artwork: s.artwork || "", duration: s.duration || 180 } as Track);
            if (id) cacheYouTubeId(s.title, s.artist, id);
          } catch {} finally {
            preloadingSet.delete(key);
          }
        })
      );
    });
  } catch {}
}

export type DeckName = "A" | "B" | "C" | "D";
export const DECKS: DeckName[] = ["A", "B", "C", "D"];
export type DeckInfo = { state: "live" | "fading" | "ready" | "idle"; title?: string };
export type DeckStatus = {
  active: DeckName;
  tail: DeckName | null;
  activeTitle?: string;
  decks: Record<DeckName, DeckInfo>;
};
const idleDecks = (): Record<DeckName, DeckInfo> => ({ A: { state: "idle" }, B: { state: "idle" }, C: { state: "idle" }, D: { state: "idle" } });
let lastDeckStatus: DeckStatus = { active: "A", tail: null, decks: idleDecks() };
export function getDeckStatus() { return lastDeckStatus; }
let lastLoading = false;
export function getPlayerLoading() { return lastLoading; }

export function GlobalAudioPlayer() {
  const {
    currentTrack, isPlaying, setProgress, next, repeat, queue, pause, nextTrack,
  } = usePlayer();

  const [youtubeId, setYoutubeId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [usePipedAudio, setUsePipedAudio] = useState(false);
  const [useNativeAudio, setUseNativeAudio] = useState(false);
  // Dual decks: two YouTube players so song 1 keeps playing while song 2 starts.
  const deckARef = useRef<YouTubePlayerRef>(null);
  const deckBRef = useRef<YouTubePlayerRef>(null);
  const deckCRef = useRef<YouTubePlayerRef>(null);
  const deckDRef = useRef<YouTubePlayerRef>(null);
  const deckRefs = { A: deckARef, B: deckBRef, C: deckCRef, D: deckDRef } as const;
  const [activeDeck, setActiveDeck] = useState<DeckName>("A");
  const activeDeckRef = useRef<DeckName>("A");
  const [tail, setTail] = useState<{ id: string; deck: DeckName } | null>(null);
  const tailRef = useRef<{ id: string; deck: DeckName } | null>(null);
  const tailFadeRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const handoffRef = useRef(false);
  const youtubeIdRef = useRef<string | null>(null);
  youtubeIdRef.current = youtubeId;
  // playerRef always points at the active deck.
  const playerRef = useRef({
    get current(): YouTubePlayerRef | null {
      return deckRefs[activeDeckRef.current].current;
    },
  }).current as React.RefObject<YouTubePlayerRef>;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const nativeProgressRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const nativeEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nativeCurrentTimeRef = useRef<number>(0);
  const nativeAssetIdRef = useRef<string | null>(null);
  // Object URL for the currently playing offline download, revoked on swap.
  const localBlobUrlRef = useRef<string | null>(null);

  // While crossfading, the outgoing audio is moved here so the new track
  // can be created in audioRef without killing the tail of the previous song.
  const prevAudioRef = useRef<HTMLAudioElement | null>(null);
  const prevFadeOutRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const searchTokenRef = useRef(0);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pipedProgressRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const iframeFailCountRef = useRef(0);
  // Position (seconds) the iframe should resume from after a stream failover.
  const resumeAtRef = useRef(0);
  const hasEndedRef = useRef(false); // Prevent double-fire of track end
  // Live mirror of the queue so callbacks (which must not re-run per queue
  // change) can still compute a track's assigned deck.
  const queueRef = useRef(queue);
  queueRef.current = queue;
  // Round-robin: the Nth song of the queue always lives on deck N % 4.
  const deckOfIndex = useCallback((i: number): DeckName => DECKS[((i % DECKS.length) + DECKS.length) % DECKS.length], []);
  const deckOfTrack = useCallback((track?: Track | null): DeckName | null => {
    if (!track) return null;
    const i = queueRef.current.findIndex((t) => t.id === track.id);
    return i >= 0 ? deckOfIndex(i) : null;
  }, [deckOfIndex]);

  const crossfadeTriggeredRef = useRef(false);
  const crossfadeFadeRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // Set when crossfade fired; consumed by the next track's load to fade in.
  const pendingFadeInRef = useRef(false);
  const fadeInIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Pre-warmed deck: the next queued song is assigned its own deck and
  // buffered there (paused, silent) so the crossfade trigger — or the Next
  // button — can start it from that deck instantly, with zero re-resolve.
  type Preload = { deck: DeckName; id: string; trackId: string; title?: string; audio: HTMLAudioElement | null };
  const [preload, setPreload] = useState<Preload | null>(null);
  const preloadRef = useRef<Preload | null>(null);
  const deckHandoffTrackRef = useRef<string | null>(null);
  const triggerCrossfadeRef = useRef<() => void>(() => {});
  const clearPreload = useCallback(() => {
    const p = preloadRef.current;
    if (p?.audio) {
      try { p.audio.pause(); p.audio.removeAttribute("src"); p.audio.load(); } catch {}
    }
    preloadRef.current = null;
    setPreload(null);
  }, []);

  useEffect(() => {
    if (!isAutoMixEnabled() || !currentTrack || !nextTrack || nextTrack.id === currentTrack.id) {
      if (preloadRef.current) clearPreload();
      return;
    }
    if (preloadRef.current?.trackId === nextTrack.id) return;
    let cancelled = false;
    (async () => {
      let id = nextTrack.youtubeId || getCachedYouTubeId(nextTrack.title, nextTrack.artist) || null;
      if (!id) {
        try { id = await searchYouTubeForTrack(nextTrack); } catch { id = null; }
      }
      if (cancelled || !id) return;
      cacheYouTubeId(nextTrack.title, nextTrack.artist, id);
      nextTrack.youtubeId = id;
      // Each queue song owns exactly one deck, assigned in order A→B→C→D.
      let deck = deckOfTrack(nextTrack) || "A";
      const busy = new Set<DeckName>([activeDeckRef.current]);
      if (tailRef.current) busy.add(tailRef.current.deck);
      if (busy.has(deck)) {
        for (let i = 1; i <= DECKS.length; i++) {
          const d = DECKS[(DECKS.indexOf(deck) + i) % DECKS.length];
          if (!busy.has(d)) { deck = d; break; }
        }
      }
      const p: Preload = { deck, id, trackId: nextTrack.id, title: nextTrack.title, audio: null };
      // Prewarm a real audio element on that deck so the handover starts
      // instantly. If no direct stream is available, the YouTube iframe
      // deck is used as the fallback handover path instead.
      if (!isNativeAudioPluginAvailable()) {
        try {
          const res = await getPipedAudioUrl(id, 6000);
          if (cancelled) return;
          if (res) {
            const a = new Audio(res.url);
            a.preload = "auto";
            a.crossOrigin = "anonymous";
            a.setAttribute("playsinline", "");
            (a as any).playsInline = true;
            a.volume = 0;
            p.audio = a;
          }
        } catch { /* fall back to iframe deck */ }
      }
      if (cancelled) {
        if (p.audio) { try { p.audio.pause(); p.audio.removeAttribute("src"); p.audio.load(); } catch {} }
        return;
      }
      preloadRef.current = p;
      setPreload(p);
    })();
    return () => { cancelled = true; };
  }, [currentTrack?.id, nextTrack?.id, clearPreload, deckOfTrack]);

  useEffect(() => {
    preloadYouTubeAPI();
    syncDownloadIndex();
    const timer = setTimeout(proactiveCacheLikedSongs, 5000);
    return () => {
      clearTimeout(timer);
      if (localBlobUrlRef.current) URL.revokeObjectURL(localBlobUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const handleSeek = (event: Event) => {
      const progress = (event as CustomEvent<{ progress?: number }>).detail?.progress;
      if (typeof progress !== "number") return;
      const ratio = Math.max(0, Math.min(1, progress));
      if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
        audioRef.current.currentTime = ratio * audioRef.current.duration;
        return;
      }
      const seconds = ratio * (currentTrack?.duration || 0);
      if (seconds > 0) playerRef.current?.seekTo(seconds);
    };
    window.addEventListener("routenet-player-seek", handleSeek);
    return () => window.removeEventListener("routenet-player-seek", handleSeek);
  }, [currentTrack?.duration]);


  useEffect(() => {
    if (currentTrack && queue.length > 0) {
      const timer = setTimeout(() => preloadNextTracks(queue, currentTrack.id), 1500);
      return () => clearTimeout(timer);
    }
  }, [currentTrack?.id, queue]);

  const clearTail = useCallback(() => {
    if (tailFadeRef.current) {
      clearInterval(tailFadeRef.current);
      tailFadeRef.current = undefined;
    }
    if (tailRef.current) {
      tailRef.current = null;
      setTail(null);
    }
  }, []);

  // Fade the outgoing YouTube deck (song 1) down while song 2 fades up.
  const fadeTail = useCallback(() => {
    const t = tailRef.current;
    if (!t || tailFadeRef.current) return;
    // No fade: the outgoing deck plays at full volume to its natural end
    // and is cleared by its own onEnd handler.
    if (FADING_DISABLED) return;
    const steps = Math.max(1, Math.floor(xfMs() / CROSSFADE_FADE_INTERVAL_MS));
    let step = 0;
    tailFadeRef.current = setInterval(() => {
      step++;
      try { deckRefs[t.deck].current?.setVolume?.(Math.max(0, fadeOutCurve(Math.min(1, step / steps)))); } catch {}
      if (step >= steps) clearTail();
    }, CROSSFADE_FADE_INTERVAL_MS);
  }, [clearTail]);

  const stopPrevAudio = useCallback(() => {
    if (prevFadeOutRef.current) {
      clearInterval(prevFadeOutRef.current);
      prevFadeOutRef.current = undefined;
    }
    if (prevAudioRef.current) {
      try { prevAudioRef.current.pause(); } catch {}
      try { prevAudioRef.current.removeAttribute("src"); prevAudioRef.current.load(); } catch {}
      prevAudioRef.current = null;
    }
    clearTail();
  }, [clearTail]);

  const stopNativeAudioPlayback = useCallback(async () => {
    if (nativeProgressRef.current) {
      clearInterval(nativeProgressRef.current);
      nativeProgressRef.current = undefined;
    }
    if (nativeEndTimeoutRef.current) {
      clearTimeout(nativeEndTimeoutRef.current);
      nativeEndTimeoutRef.current = undefined;
    }
    nativeCurrentTimeRef.current = 0;
    if (nativeAssetIdRef.current) {
      await stopNativeAudio(nativeAssetIdRef.current);
      nativeAssetIdRef.current = null;
    }
    setUseNativeAudio(false);
  }, []);

  // Handle track end — called from both iframe and piped
  const handleTrackEnd = useCallback(() => {
    if (hasEndedRef.current) return; // Prevent double-fire
    hasEndedRef.current = true;

    // Only fire DJ event if DJ is enabled (avoids interference with normal playback)
    const djEnabled = (window as any).__djEnabled === true;

    window.dispatchEvent(new CustomEvent("player-track-ended"));
    if (djEnabled) {
      window.dispatchEvent(new CustomEvent("dj-track-ended"));
    }

    if (repeat === "one") {
      // Replay same track
      hasEndedRef.current = false;
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      } else {
        playerRef.current?.seekTo(0);
      }
    } else if (!djEnabled) {
      // Normal player — advance to next track
      setTimeout(() => {
        hasEndedRef.current = false;
        next();
      }, 150);
    } else {
      // DJ handles its own advancement; just reset the flag
      setTimeout(() => {
        hasEndedRef.current = false;
      }, 1000);
    }
  }, [repeat, next]);

  const startNativeProgress = useCallback(
    (duration: number) => {
      if (nativeProgressRef.current) {
        clearInterval(nativeProgressRef.current);
        nativeProgressRef.current = undefined;
      }
      if (nativeEndTimeoutRef.current) {
        clearTimeout(nativeEndTimeoutRef.current);
        nativeEndTimeoutRef.current = undefined;
      }
      nativeCurrentTimeRef.current = 0;
      if (duration > 0) {
        nativeProgressRef.current = setInterval(() => {
          const assetId = nativeAssetIdRef.current;
          if (!assetId) return;
          getNativeAudioCurrentTime(assetId).then((currentTime) => {
            if (currentTime === null) return;
            nativeCurrentTimeRef.current = Math.min(duration, Math.max(0, Math.floor(currentTime)));
            setProgress(nativeCurrentTimeRef.current, duration);
            if (nativeCurrentTimeRef.current >= duration - 1 && !hasEndedRef.current) {
              handleTrackEnd();
            }
          });
        }, 1000);
      }
    },
    [handleTrackEnd, setProgress]
  );

  const stopPipedAudio = useCallback(() => {
    if (audioRef.current) {
      const a = audioRef.current;
      audioRef.current = null; // detach first so its teardown error is ignored
      try { a.pause(); } catch {}
      try { a.removeAttribute("src"); a.load(); } catch {}
    }
    if (pipedProgressRef.current) {
      clearInterval(pipedProgressRef.current);
      pipedProgressRef.current = undefined;
    }
    if (crossfadeFadeRef.current) {
      clearInterval(crossfadeFadeRef.current);
      crossfadeFadeRef.current = undefined;
    }
    setUsePipedAudio(false);
    stopNativeAudioPlayback().catch(() => {});
  }, [stopNativeAudioPlayback]);

  /**
   * Hand playback over to the YouTube iframe, resuming at `seconds`.
   * Used whenever a direct stream dies so a song never stops half-way.
   */
  const failoverToIframe = useCallback((videoId: string, seconds: number) => {
    resumeAtRef.current = seconds > 2 ? seconds : 0;
    iframeFailCountRef.current = 0;
    setYoutubeId(videoId);
    setShowPlayer(true);
  }, []);



  /**
   * Promote audioRef to prevAudioRef and begin fading it out over the
   * crossfade window. The element keeps playing — only `audioRef` is
   * cleared so the next track can attach without cutting the tail.
   */
  const beginPrevFadeOut = useCallback(() => {
    // Kill any earlier prev (very fast back-to-back crossfade)
    stopPrevAudio();
    const outgoing = audioRef.current;
    if (!outgoing) return;
    prevAudioRef.current = outgoing;
    audioRef.current = null;
    if (pipedProgressRef.current) {
      clearInterval(pipedProgressRef.current);
      pipedProgressRef.current = undefined;
    }
    // The fade itself starts once song 2 is actually playing (startPrevFade),
    // so song 1 keeps playing at full volume while song 2 loads.
  }, [stopPrevAudio]);

  const startPrevFade = useCallback((durationMs?: number) => {
    const outgoing = prevAudioRef.current;
    if (!outgoing || prevFadeOutRef.current) return;
    if (FADING_DISABLED) {
      // Song 1 keeps playing at full volume until it naturally ends.
      if ((outgoing as any).__tailWired) return;
      (outgoing as any).__tailWired = true;
      const done = () => {
        try { outgoing.pause(); outgoing.removeAttribute("src"); outgoing.load(); } catch {}
        if (prevAudioRef.current === outgoing) prevAudioRef.current = null;
      };
      outgoing.addEventListener("ended", done, { once: true });
      outgoing.addEventListener("error", done, { once: true });
      return;
    }
    const startVol = outgoing.volume;
    const fadeMs = Math.max(CROSSFADE_FADE_INTERVAL_MS, durationMs ?? xfMs());
    const steps = Math.max(1, Math.floor(fadeMs / CROSSFADE_FADE_INTERVAL_MS));
    let step = 0;
    (outgoing as any).__fading = true;
    prevFadeOutRef.current = setInterval(() => {
      step++;
      try { outgoing.volume = Math.max(0, startVol * fadeOutCurve(Math.min(1, step / steps))); } catch {}
      if (step >= steps) {
        if (prevFadeOutRef.current) {
          clearInterval(prevFadeOutRef.current);
          prevFadeOutRef.current = undefined;
        }
        (outgoing as any).__fading = false;
        try { outgoing.pause(); } catch {}
        try { outgoing.removeAttribute("src"); outgoing.load(); } catch {}
        if (prevAudioRef.current === outgoing) prevAudioRef.current = null;
      }
    }, CROSSFADE_FADE_INTERVAL_MS);
  }, [stopPrevAudio]);

  /**
   * Wire one piped deck: queue advance on natural end, iframe failover on
   * error/stall, and progress + crossfade triggering. Both the normal load
   * path and the deck handover path route through here so every deck
   * behaves identically.
   */
  const wirePipedDeckAudio = useCallback((audio: HTMLAudioElement, videoId: string | null, track: Track) => {
    // Only the deck that is CURRENTLY active may advance the queue or fail
    // over. A fading-out previous deck ending/erroring must never touch the
    // new song (that caused the "skips the next song" and freeze bugs).
    audio.addEventListener("ended", () => {
      if (audioRef.current !== audio) return;
      handleTrackEnd();
    });

    // If the direct stream dies part-way through (expired/geo-locked CDN
    // URL, network hiccup), don't kill playback — hand the rest of the
    // song over to the YouTube iframe at the exact same position so the
    // track always plays to the end.
    audio.addEventListener("error", () => {
      if (audioRef.current !== audio) return; // stale/torn-down deck
      if (!audio.src || audio.src === window.location.href) return; // intentional teardown
      const at = audio.currentTime || 0;
      console.warn("[Piped Audio] Playback error — failing over to iframe at", at);
      markAsIframeOnly(videoId);
      stopPipedAudio();
      failoverToIframe(videoId, at);
    });

    if (pipedProgressRef.current) {
      clearInterval(pipedProgressRef.current);
      pipedProgressRef.current = undefined;
    }
    let lastTime = -1;
    let stalledTicks = 0;
    pipedProgressRef.current = setInterval(() => {
      if (audioRef.current) {
        const ct = audioRef.current.currentTime;
        const dur = audioRef.current.duration;

        // Stall watchdog: playback position frozen for ~8s while we think
        // we're playing means the stream died silently. Fail over.
        if (!audioRef.current.paused && !hasEndedRef.current) {
          if (Math.abs(ct - lastTime) < 0.01) {
            stalledTicks++;
            if (stalledTicks > 32) {
              stalledTicks = 0;
              console.warn("[Piped Audio] Stalled — failing over to iframe at", ct);
              markAsIframeOnly(videoId);
              stopPipedAudio();
              failoverToIframe(videoId, ct);
              return;
            }
          } else {
            stalledTicks = 0;
          }
        }
        lastTime = ct;

        if (dur > 0) {
          setProgress(ct, dur);
          if (
            isAutoMixEnabled() &&
            dur > (xfMs() / 1000) + 1 &&
            dur - ct <= (xfMs() / 1000) &&
            !crossfadeTriggeredRef.current &&
            !hasEndedRef.current
          ) {
            triggerCrossfadeRef.current();
          }
        }
      }
    }, 250);
  }, [handleTrackEnd, stopPipedAudio, failoverToIframe, setProgress]);

  // The track the user most recently selected — stale loads bail out.
  const activeTrackIdRef = useRef<string | null>(null);

  // Offline-first: a downloaded blob, otherwise Piped audio
  const tryPlayWithPiped = useCallback(async (videoId: string | null, track: Track) => {
    let result: { url: string } | null = null;

    // Downloaded tracks always play from local storage — works fully offline.
    // Query IndexedDB directly rather than trusting the in-memory index, which
    // may not be populated yet on a cold start (exactly the offline case).
    try {
      const saved = await getSong(track.id);
      if (saved?.blob || saved?.localUri) {
        if (localBlobUrlRef.current) {
          URL.revokeObjectURL(localBlobUrlRef.current);
          localBlobUrlRef.current = null;
        }
        if (saved.localUri) {
          result = { url: saved.localUri };
        } else {
          localBlobUrlRef.current = URL.createObjectURL(saved.blob as Blob);
          result = { url: localBlobUrlRef.current };
        }
      }
    } catch { /* fall through to network */ }

    if (!result) {
      if (!videoId || shouldUseIframe(videoId)) return false;
    }

    try {
      if (!result) result = await getPipedAudioUrl(videoId, 6000);
      if (!result) return false;
      if (activeTrackIdRef.current !== track.id) return true; // user moved on


      if (isNativeAudioPluginAvailable()) {
        stopPipedAudio();
        await stopNativeAudioPlayback();

        await startAppForegroundService();

        const loaded = await preloadNativeAudio(track.id, result.url, {
          title: track.title,
          artist: track.artist,
          album: track.album || "",
          artworkUrl: track.artwork || undefined,
        });
        if (loaded) {
          nativeAssetIdRef.current = track.id;
          setUseNativeAudio(true);
          setUsePipedAudio(false);
          if (track.duration > 0) {
            startNativeProgress(track.duration);
          }
          if ("mediaSession" in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: track.title,
              artist: track.artist,
              album: track.album || "",
              artwork: track.artwork ? [{ src: track.artwork, sizes: "512x512" }] : [],
            });
          }
          const played = await playNativeAudio(track.id);
          return played;
        }
      }

      stopPipedAudio();

      const isLocalSource = result.url.startsWith("blob:") || result.url.startsWith("file:");
      const audio = new Audio(result.url);
      // CORS mode must not be set for local blob/file sources.
      if (!isLocalSource) audio.crossOrigin = "anonymous";
      // Background-playback hardening: make sure the element is treated as
      // a real media player, preloads aggressively, and survives tab hide.
      audio.preload = "auto";
      (audio as any).playsInline = true;
      audio.setAttribute("playsinline", "");
      audio.setAttribute("webkit-playsinline", "");
      if (activeTrackIdRef.current !== track.id) return true;
      audio.autoplay = true;
      audioRef.current = audio;

      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album || "",
          artwork: track.artwork ? [{ src: track.artwork, sizes: "512x512" }] : [],
        });
      }

      wirePipedDeckAudio(audio, videoId, track);

      await audio.play();
      setUsePipedAudio(true);

      console.log(`✅ Playing via Piped audio: ${track.title}`);
      return true;
    } catch {
      return false;
    }
  }, [stopPipedAudio, setProgress, wirePipedDeckAudio]);

  // Handle play/pause for piped or native audio
  useEffect(() => {
    if (useNativeAudio) {
      if (currentTrack?.id) {
        if (isPlaying) {
          resumeNativeAudio(currentTrack.id).catch(() => {});
        } else {
          pauseNativeAudio(currentTrack.id).catch(() => {});
        }
      }
      return;
    }

    if (!usePipedAudio || !audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play().catch(() => {});
      // Keep the outgoing crossfade tail in sync with play/pause so both
      // decks share one transport control.
      if (prevAudioRef.current && !prevFadeOutRef.current) prevAudioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
      if (prevAudioRef.current && !prevFadeOutRef.current) prevAudioRef.current.pause();
    }
  }, [isPlaying, usePipedAudio, useNativeAudio, currentTrack?.id]);

  // Reset hasEnded when track changes
  useEffect(() => {
    hasEndedRef.current = false;
    crossfadeTriggeredRef.current = false;
    if (crossfadeFadeRef.current) {
      clearInterval(crossfadeFadeRef.current);
      crossfadeFadeRef.current = undefined;
    }
    // If this track change was NOT triggered by an automix crossfade,
    // stop any lingering previous-audio fade-out so we don't have two
    // tracks overlapping after a manual skip.
    if (!pendingFadeInRef.current) {
      stopPrevAudio();
    }
    if (useNativeAudio) {
      nativeCurrentTimeRef.current = 0;
      if (nativeProgressRef.current) {
        clearInterval(nativeProgressRef.current);
        nativeProgressRef.current = undefined;
      }
      if (nativeEndTimeoutRef.current) {
        clearTimeout(nativeEndTimeoutRef.current);
        nativeEndTimeoutRef.current = undefined;
      }
    }
    // If a crossfade triggered this transition, ramp the new track's
    // volume from 0 to 1 over the fade-in window (Piped audio only —
    // YouTube iframe volume control isn't reliable cross-origin).
    if (fadeInIntervalRef.current) {
      clearInterval(fadeInIntervalRef.current);
      fadeInIntervalRef.current = undefined;
    }
    if (pendingFadeInRef.current) {
      pendingFadeInRef.current = false;
      handoffRef.current = true;
      // Dual-deck: if song 1 is on a YouTube deck, keep that deck playing
      // as the "tail" and send song 2 to the other deck.
      if (deckHandoffTrackRef.current !== currentTrack?.id && !usePipedAudio && showPlayer && youtubeId) {
        const old = activeDeckRef.current;
        const nextDeck = DECKS[(DECKS.indexOf(old) + 1) % DECKS.length];
        const t = { id: youtubeId, deck: old };
        tailRef.current = t;
        setTail(t);
        activeDeckRef.current = nextDeck;
        setActiveDeck(nextDeck);
        setYoutubeId(null);
      }
      const ramp = () => {
        const audio = audioRef.current;
        const yt = !audio ? deckRefs[activeDeckRef.current].current : null;
        if (!audio && !(yt && youtubeIdRef.current)) return false;
        const setVol = (v: number) => {
          if (audio) audio.volume = v;
          else yt?.setVolume?.(v);
        };
        // Song 2 starts at normal volume while song 1 finishes on its deck.
        startPrevFade();
        fadeTail();
        if (FADING_DISABLED) { try { setVol(getGlobalVolume()); } catch {} return true; }
        setVol(0);
        const fadeMs = xfMs();
        const steps = Math.max(1, Math.floor(fadeMs / CROSSFADE_FADE_INTERVAL_MS));
        let step = 0;
        fadeInIntervalRef.current = setInterval(() => {
          step++;
          try { setVol(Math.min(1, fadeInCurve(step / steps))); } catch {}
          if (step >= steps && fadeInIntervalRef.current) {
            try { setVol(1); } catch {}
            clearInterval(fadeInIntervalRef.current);
            fadeInIntervalRef.current = undefined;
          }
        }, CROSSFADE_FADE_INTERVAL_MS);
        // Safety net: never leave the new song stuck silent if the fade
        // gets interrupted (track change, tab throttling, etc.).
        setTimeout(() => {
          try { setVol(1); } catch {}
        }, fadeMs + 1500);
        return true;
      };
      // Song 2 may still be loading — song 1 keeps playing at full volume
      // until it's ready, then both blend.
      let tries = 0;
      const waiter = setInterval(() => {
        tries++;
        if (ramp()) { clearInterval(waiter); return; }
        if (tries > 60) {
          clearInterval(waiter);
          startPrevFade();
          fadeTail();
        }
      }, 200);
    } else if (audioRef.current) {
      audioRef.current.volume = 1;
    }
  }, [currentTrack?.id]);

  // Search YouTube for current track
  useEffect(() => {
    const track = currentTrack;
    const requestToken = ++searchTokenRef.current;
    const switched = activeTrackIdRef.current !== (track?.id ?? null);
    activeTrackIdRef.current = track?.id ?? null;
    // Deck handover already started this song on its own pre-warmed deck.
    if (track && deckHandoffTrackRef.current === track.id) {
      deckHandoffTrackRef.current = null;
      handoffRef.current = false;
      setIsSearching(false);
      return;
    }
    deckHandoffTrackRef.current = null;
    // Stop the previous song right away so skips feel instant
    // (unless an automatic crossfade is handing over).
    const handoff = pendingFadeInRef.current || handoffRef.current;
    handoffRef.current = false;
    // Each song owns its deck: Next moves forward, Back moves backward.
    if (track && switched) {
      const d = deckOfTrack(track);
      if (d && d !== activeDeckRef.current) {
        activeDeckRef.current = d;
        setActiveDeck(d);
      }
    }
    if (track && switched && !handoff) {
      clearPreload();
      stopPrevAudio();
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch {}
      }
      stopNativeAudioPlayback().catch(() => {});
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = undefined;
    }

    if (!track) {
      setYoutubeId(null);
      setIsSearching(false);
      stopPipedAudio();
      return;
    }

    const resolveAndPlay = async (videoId: string) => {
      if (requestToken !== searchTokenRef.current) return;

      stopPipedAudio();
      iframeFailCountRef.current = 0;
      resumeAtRef.current = 0;


      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album || "",
          artwork: track.artwork ? [{ src: track.artwork, sizes: "512x512" }] : [],
        });
      }

      if (isNativeAudioPluginAvailable()) {
        const pipedOk = await tryPlayWithPiped(videoId, track);
        if (pipedOk) {
          setYoutubeId(null);
          setShowPlayer(false);
          return;
        }
      }
      // On web (no native plugin), still try Piped first — it gives us real
      // <audio> control which is the only way crossfade can overlap two
      // tracks. The YouTube iframe can't be ducked/overlapped reliably.
      if (!isNativeAudioPluginAvailable()) {
        const pipedOk = await tryPlayWithPiped(videoId, track);
        if (pipedOk) {
          setYoutubeId(null);
          setShowPlayer(false);
          return;
        }
      }

      setYoutubeId(videoId);
      setShowPlayer(true);
    };

    const startPlayback = async () => {
      // Try the local blob before resolving any network source. This is what
      // makes a downloaded track playable when the device is offline.
      const hasLocalCopy =
        isDownloadedSync(track.id) || !navigator.onLine || !!(await getSong(track.id));
      if (hasLocalCopy) {
        const playedOffline = await tryPlayWithPiped(track.youtubeId || null, track);
        if (requestToken !== searchTokenRef.current) return;
        if (playedOffline) {
          setIsSearching(false);
          setYoutubeId(null);
          setShowPlayer(false);
          return;
        }
      }

      if (track.youtubeId) {
        cacheYouTubeId(track.title, track.artist, track.youtubeId);
        stopPipedAudio();
        setIsSearching(false);
        resolveAndPlay(track.youtubeId);
        return;
      }

    const memCached = getCachedYouTubeId(track.title, track.artist);
    if (memCached) {
      track.youtubeId = memCached;
      setIsSearching(false);
      resolveAndPlay(memCached);
      return;
    }

      setIsSearching(true);
      stopPipedAudio();

      // Slow songs are never skipped — just let the user know it's still loading.
      searchTimeoutRef.current = setTimeout(() => {
        if (requestToken === searchTokenRef.current) {
          toast({ title: "Still loading", description: `"${track.title}" is taking a bit longer…` });
        }
      }, 20000);

      const trySearch = async (attempt: number): Promise<string | null> => {
        try {
          const id = await searchYouTubeForTrack(track);
          if (id) return id;
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 1500));
            return trySearch(attempt + 1);
          }
          return null;
        } catch (e) {
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 1500));
            return trySearch(attempt + 1);
          }
          throw e;
        }
      };

      trySearch(1)
        .then(async (id) => {
          if (requestToken !== searchTokenRef.current) return;
          if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

          if (id) {
            cacheYouTubeId(track.title, track.artist, id);
            track.youtubeId = id;
            await resolveAndPlay(id);
          } else {
            toast({ title: "Song unavailable", description: `Couldn't find "${track.title}" — skipping`, variant: "destructive" });
            next();
          }
        })
        .catch((e) => {
          if (requestToken !== searchTokenRef.current) return;
          if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
          console.error("[GlobalAudioPlayer] YouTube search error:", e);
          toast({ title: "Playback error", description: `Skipping "${track.title}"`, variant: "destructive" });
          next();
        })
        .finally(() => {
          if (requestToken === searchTokenRef.current) setIsSearching(false);
        });
    };

    void startPlayback();

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.youtubeId, next, stopPipedAudio, tryPlayWithPiped]);

  const triggerCrossfade = useCallback(() => {
    // Fading disabled: songs play fully at normal volume, then the next
    // song starts on its own deck when the current one ends.
    if (crossfadeTriggeredRef.current || hasEndedRef.current) return;
    if (repeat === "one") return;
    if ((window as any).__djEnabled === true) return;
    const p = preloadRef.current;
    // No pre-warmed deck ready → never skip: let the song play to its
    // natural end and hand over normally.
    if (!p || !nextTrack || p.trackId !== nextTrack.id || useNativeAudio) return;
    crossfadeTriggeredRef.current = true;
    pendingFadeInRef.current = true;
    deckHandoffTrackRef.current = p.trackId;

    // Outgoing song keeps playing on its own deck / audio element.
    if (audioRef.current && usePipedAudio) {
      beginPrevFadeOut();
      setUsePipedAudio(false);
    } else if (showPlayer && youtubeIdRef.current) {
      const t = { id: youtubeIdRef.current, deck: activeDeckRef.current };
      tailRef.current = t;
      setTail(t);
    }
    try { deckRefs[p.deck].current?.setVolume?.(FADING_DISABLED ? getGlobalVolume() : 0); } catch {}
    preloadRef.current = null;
    setPreload(null);
    activeDeckRef.current = p.deck;
    setActiveDeck(p.deck);
    resumeAtRef.current = 0;
    setYoutubeId(p.id);
    setShowPlayer(true);
    next();
  }, [next, nextTrack, repeat, usePipedAudio, useNativeAudio, showPlayer, beginPrevFadeOut]);
  triggerCrossfadeRef.current = triggerCrossfade;

  const handleProgress = useCallback(
    (currentTime: number, duration: number) => {
      setProgress(currentTime, duration);
      if (
        isAutoMixEnabled() &&
        duration > (xfMs() / 1000) + 1 &&
        currentTime > 0 &&
        duration - currentTime <= (xfMs() / 1000) &&
        !crossfadeTriggeredRef.current
      ) {
        triggerCrossfade();
      }
    },
    [setProgress, triggerCrossfade]
  );

  const handleVideoEnd = useCallback(() => {
    handleTrackEnd();
  }, [handleTrackEnd]);

  const handlePlayerError = useCallback(() => {
    iframeFailCountRef.current++;
    if (iframeFailCountRef.current > 2 && currentTrack && youtubeId) {
      console.warn("[Player] Iframe failed, trying Piped fallback...");
      tryPlayWithPiped(youtubeId, currentTrack).then(pipedOk => {
        if (pipedOk) {
          setYoutubeId(null);
          setShowPlayer(false);
        } else {
          toast({ title: "Playback failed", description: `Skipping "${currentTrack.title}"`, variant: "destructive" });
          next();
        }
      });
    }
  }, [currentTrack, youtubeId, tryPlayWithPiped, next]);

  useEffect(() => {
    (window as any).__globalAudioPlayerRef = playerRef;
    (window as any).__globalAudioRef = audioRef;
    (window as any).__isUsingPipedAudio = () => usePipedAudio;
    return () => {
      delete (window as any).__globalAudioPlayerRef;
      delete (window as any).__globalAudioRef;
      delete (window as any).__isUsingPipedAudio;
    };
  }, [usePipedAudio]);

  useEffect(() => {
    if (isPlaying && (youtubeId || usePipedAudio || useNativeAudio)) {
      startBackgroundKeepAlive();
    } else {
      stopBackgroundKeepAlive();
    }
    return () => stopBackgroundKeepAlive();
  }, [isPlaying, youtubeId, usePipedAudio, useNativeAudio]);

  useEffect(() => {
    lastLoading = isSearching;
    window.dispatchEvent(new CustomEvent("player-loading", { detail: isSearching }));
  }, [isSearching]);

  useEffect(() => {
    const decks = idleDecks();
    if (preload && preload.deck !== activeDeck) decks[preload.deck] = { state: "ready", title: preload.title };
    if (tail && tail.deck !== activeDeck) decks[tail.deck] = { state: "fading" };
    decks[activeDeck] = { state: "live", title: currentTrack?.title };
    lastDeckStatus = { active: activeDeck, tail: tail?.deck ?? null, activeTitle: currentTrack?.title, decks };
    window.dispatchEvent(new CustomEvent("deck-status", { detail: lastDeckStatus }));
  }, [activeDeck, tail, preload, currentTrack?.title]);

  const activeId = !usePipedAudio && showPlayer ? youtubeId : null;
  const deckId = (d: DeckName) =>
    d === activeDeck ? activeId
      : tail && tail.deck === d ? tail.id
      : preload && preload.deck === d ? preload.id
      : null;
  const ids = DECKS.map((d) => [d, deckId(d)] as const);

  if (!ids.some(([, id]) => id)) return null;

  const renderDeck = (d: DeckName, id: string | null) => {
    if (!id) return null;
    const isActive = d === activeDeck && id === activeId;
    const isTail = !isActive && tail?.deck === d;
    const isPreload = !isActive && !isTail;
    return (
      <YouTubePlayer
        key={d}
        ref={deckRefs[d]}
        videoId={id}
        startSeconds={isActive ? resumeAtRef.current : 0}
        isPlaying={isPreload ? false : isPlaying}
        onProgress={isActive ? handleProgress : () => {}}
        onEnd={isActive ? handleVideoEnd : isTail ? clearTail : () => {}}
        onReady={() => console.log(`[GlobalAudioPlayer] Deck ${d} ready`)}
        onError={isActive ? handlePlayerError : isTail ? clearTail : clearPreload}
      />
    );
  };

  return (
    <div className="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0" aria-hidden="true">
      {ids.map(([d, id]) => renderDeck(d, id))}
    </div>
  );
}

export function getGlobalPlayerRef(): YouTubePlayerRef | null {
  return (window as any).__globalAudioPlayerRef?.current || null;
}

export function seekGlobalAudio(seconds: number) {
  const isPiped = (window as any).__isUsingPipedAudio?.();
  if (isPiped) {
    const audio = (window as any).__globalAudioRef?.current as HTMLAudioElement | null;
    if (audio) audio.currentTime = seconds;
  } else {
    getGlobalPlayerRef()?.seekTo(seconds);
  }
}

export function getGlobalCurrentTime(): number {
  const isPiped = (window as any).__isUsingPipedAudio?.();
  if (isPiped) {
    const audio = (window as any).__globalAudioRef?.current as HTMLAudioElement | null;
    return audio?.currentTime || 0;
  }
  return getGlobalPlayerRef()?.getCurrentTime() || 0;
}

/** 0..1 volume applied to whichever backend is currently playing. */
export function setGlobalVolume(value: number) {
  const v = Math.min(1, Math.max(0, value));
  try { localStorage.setItem("routenet_volume", String(v)); } catch { /* ignore */ }
  const audio = (window as any).__globalAudioRef?.current as HTMLAudioElement | null;
  if (audio) audio.volume = v;
  getGlobalPlayerRef()?.setVolume?.(v);
}

export function getGlobalVolume(): number {
  const audio = (window as any).__globalAudioRef?.current as HTMLAudioElement | null;
  if (audio && typeof audio.volume === "number") return audio.volume;
  try {
    const raw = localStorage.getItem("routenet_volume");
    if (raw !== null) return Math.min(1, Math.max(0, Number(raw)));
  } catch { /* ignore */ }
  return 1;
}

export function getGlobalDuration(): number {
  const isPiped = (window as any).__isUsingPipedAudio?.();
  if (isPiped) {
    const audio = (window as any).__globalAudioRef?.current as HTMLAudioElement | null;
    return audio?.duration || 0;
  }
  return getGlobalPlayerRef()?.getDuration() || 0;
}
