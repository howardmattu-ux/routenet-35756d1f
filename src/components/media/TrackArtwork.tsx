import { useEffect, useState } from "react";
import type { Track } from "@/data/mockData";
import { cn } from "@/lib/utils";
import { getCachedYouTubeId } from "@/components/player/GlobalAudioPlayer";

const PLACEHOLDER_ART = "/placeholder.svg";

const youtubeArtwork = (videoId?: string) => videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";

export function resolvedTrackArtwork(track?: Pick<Track, "artwork" | "youtubeId" | "title" | "artist"> | null) {
  if (!track) return PLACEHOLDER_ART;
  return track.artwork || youtubeArtwork(track.youtubeId || getCachedYouTubeId(track.title, track.artist)) || PLACEHOLDER_ART;
}

export function TrackArtwork({ track, alt, className, loading = "lazy" }: {
  track: Pick<Track, "id" | "artwork" | "youtubeId" | "title" | "artist" | "album" | "duration">;
  alt?: string;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const [src, setSrc] = useState(() => resolvedTrackArtwork(track));
  const [lookedUp, setLookedUp] = useState(false);

  useEffect(() => {
    setSrc(resolvedTrackArtwork(track));
    setLookedUp(false);
  }, [track.id, track.artwork, track.youtubeId, track.title, track.artist]);

  // No network lookups on error: a scrolling list must never fire a request
  // storm. Deezer artwork first, then a cached YouTube thumbnail, then placeholder.
  const handleError = () => {
    if (lookedUp) { if (src !== PLACEHOLDER_ART) setSrc(PLACEHOLDER_ART); return; }
    setLookedUp(true);
    const knownFallback = youtubeArtwork(track.youtubeId || getCachedYouTubeId(track.title, track.artist));
    setSrc(knownFallback && src !== knownFallback ? knownFallback : PLACEHOLDER_ART);
  };

  return <img src={src} alt={alt ?? `${track.title} artwork`} className={cn("bg-muted object-cover", className)} loading={loading} onError={handleError} />;
}