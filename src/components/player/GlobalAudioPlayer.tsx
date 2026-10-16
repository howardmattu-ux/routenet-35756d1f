import { useEffect, useRef, useCallback, useState } from "react";
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

let lastLoading = false;
export function getPlayerLoading() { return lastLoading; }

export function GlobalAudioPlayer() {
  const {
    currentTrack, isPlaying, setProgress, next, repeat,
  } = usePlayer();

  const [youtubeId, setYoutubeId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [usePipedAudio, setUsePipedAudio] = useState(false);
  const [useNativeAudio, setUseNativeAudio] = useState(false);
  const playerRef = useRef<YouTubePlayerRef>(null);
  const youtubeIdRef = useRef<string | null>(null);
  youtubeIdRef.current = youtubeId;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const nativeProgressRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const nativeEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nativeCurrentTimeRef = useRef<number>(0);
  const nativeAssetIdRef = useRef<string | null>(null);
  // Object URL for the currently playing offline download, revoked on swap.
  const localBlobUrlRef = useRef<string | null>(null);

  const searchTokenRef = useRef(0);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pipedProgressRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const iframeFailCountRef = useRef(0);
  // Position (seconds) the iframe should resume from after a stream failover.
  const resumeAtRef = useRef(0);
  const hasEndedRef = useRef(false); // Prevent double-fire of track end
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
   * Wire piped audio: queue advance on natural end and iframe failover on
   * error or stall.
   */
  const wirePipedDeckAudio = useCallback((audio: HTMLAudioElement, videoId: string | null, track: Track) => {
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
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, usePipedAudio, useNativeAudio, currentTrack?.id]);

  // Reset hasEnded when track changes
  useEffect(() => {
    hasEndedRef.current = false;
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
  }, [currentTrack?.id]);

  // Search YouTube for current track
  useEffect(() => {
    const track = currentTrack;
    const requestToken = ++searchTokenRef.current;
    const switched = activeTrackIdRef.current !== (track?.id ?? null);
    activeTrackIdRef.current = track?.id ?? null;
    if (track && switched) {
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
      // On web (no native plugin), try Piped first for direct audio controls.
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

  const handleProgress = useCallback(
    (currentTime: number, duration: number) => {
      setProgress(currentTime, duration);
      if (currentTime > 0) setIsSearching(false);
    },
    [setProgress]
  );

  const handleVideoEnd = useCallback(() => {
    handleTrackEnd();
  }, [handleTrackEnd]);

  const handlePlayerError = useCallback(() => {
    iframeFailCountRef.current++;
    // YouTube reports blocked videos only once, so react on the first error.
    if (iframeFailCountRef.current === 1 && currentTrack && youtubeId) {
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

  if (!youtubeId || !showPlayer || usePipedAudio) return null;
  return (
    <div className="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0" aria-hidden="true">
      <YouTubePlayer
        ref={playerRef}
        videoId={youtubeId}
        startSeconds={resumeAtRef.current}
        isPlaying={isPlaying}
        onProgress={handleProgress}
        onEnd={handleVideoEnd}
        onReady={() => console.log("[GlobalAudioPlayer] Player ready")}
        onError={handlePlayerError}
      />
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
