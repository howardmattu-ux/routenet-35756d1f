import { useEffect, useState } from "react";
import { Home, Search, Library, Radio, Heart, Clock3, Plus, Music2 } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AppLogo } from "@/components/brand/AppLogo";
import { Button } from "@/components/ui/button";
import { getUserPlaylists, type PlaylistRow } from "@/services/playlistService";
import { getLikedSongs, getLikedAlbums } from "@/pages/Library";
import { getPlaylistTracks } from "@/services/playlistService";
import type { Track } from "@/data/mockData";
import { cn } from "@/lib/utils";

const primary = [
  { path: "/home", label: "Home", icon: Home },
  { path: "/search", label: "Search", icon: Search },
  { path: "/radio", label: "Radio", icon: Radio },
];

export function DesktopSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [liked, setLiked] = useState<Track[]>([]);
  const [albums, setAlbums] = useState(getLikedAlbums());

  useEffect(() => {
    const syncLiked = () => { setLiked(getLikedSongs()); setAlbums(getLikedAlbums()); };
    // Playlists without a cover use their first song's artwork.
    const syncPlaylists = () => getUserPlaylists().then(async (rows) => {
      const withCovers = await Promise.all(rows.map(async (p) => {
        if (p.cover_image) return p;
        const first = (await getPlaylistTracks(p.id).catch(() => [])).find((t) => t.track_artwork);
        return { ...p, cover_image: first?.track_artwork ?? null };
      }));
      setPlaylists(withCovers);
    }).catch(() => undefined);
    syncLiked();
    syncPlaylists();
    window.addEventListener("liked-updated", syncLiked);
    window.addEventListener("playlists-updated", syncPlaylists);
    return () => { window.removeEventListener("liked-updated", syncLiked); window.removeEventListener("playlists-updated", syncPlaylists); };
  }, [location.pathname]);

  return (
    <aside className="hidden h-full min-h-0 w-[260px] shrink-0 flex-col lg:flex xl:w-[280px] 2xl:w-[300px]">
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto rounded-lg bg-background-elevated px-2 pb-6 pt-3">
        <div className="mb-3 flex items-center justify-between px-2">
          <NavLink to="/library" className="flex items-center gap-3 text-[15px] font-bold text-foreground"><Library className="h-6 w-6" /> Your Library</NavLink>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full bg-secondary" onClick={() => navigate("/create-playlist")} aria-label="Create playlist">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="mb-3 flex gap-2 px-2">
          {[{ l: "Playlists", p: "/library" }, { l: "By you", p: "/recently-played" }].map((c, i) => (
            <button key={c.l} onClick={() => navigate(c.p)} className={cn("rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors", i === 0 ? "bg-foreground text-background" : "bg-secondary text-foreground hover:bg-muted")}>{c.l}</button>
          ))}
        </div>
        <div className="mb-2 flex items-center justify-between px-2 text-muted-foreground">
          <Search className="h-4 w-4" />
          <span className="flex items-center gap-1.5 text-[13px]">Recents <Clock3 className="h-3.5 w-3.5" /></span>
        </div>
        <button onClick={() => navigate("/liked")} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60">
          {liked[0]?.artwork
            ? <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded"><img src={liked[0].artwork} alt="" className="h-full w-full object-cover" /><span className="absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary"><Heart className="h-2.5 w-2.5 text-primary-foreground" fill="currentColor" /></span></span>
            : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gradient-to-br from-accent to-primary"><Heart className="h-5 w-5 text-primary-foreground" fill="currentColor" /></span>}
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold text-sidebar-foreground">Liked Songs</span>
            <span className="block text-[13px] text-muted-foreground">Playlist • {liked.length} songs</span>
          </span>
        </button>


        {playlists.length > 0 && (
          <div className="mt-4">
            <span className="mb-1 block px-2 text-[11px] font-bold uppercase text-muted-foreground">Playlists</span>
            {playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/user-playlist/${p.id}`)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
              >
                {p.cover_image
                  ? <img src={p.cover_image} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />

                  : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-secondary"><Music2 className="h-4 w-4 text-muted-foreground" /></span>}
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-sidebar-foreground">{p.name}</span>
                  <span className="block text-[13px] text-muted-foreground">Playlist</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {albums.length > 0 && (
          <div className="mt-4">
            <span className="mb-1 block px-2 text-[11px] font-bold uppercase text-muted-foreground">Albums</span>
            {albums.map((a) => (
              <button key={a.id} onClick={() => navigate(`/album/${a.id}`)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60">
                <img src={a.artwork || "/placeholder.svg"} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-sidebar-foreground">{a.title}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">Album • {a.artist}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {liked.length > 0 && (
          <div className="mt-4">
            <span className="mb-1 block px-2 text-[11px] font-bold uppercase text-muted-foreground">Saved songs</span>
            {liked.slice(0, 20).map((track) => (
              <button
                key={`${track.title}-${track.artist}`}
                onClick={() => navigate("/liked")}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
              >
                <img src={track.artwork || "/placeholder.svg"} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-sidebar-foreground">{track.title}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">{track.artist}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
