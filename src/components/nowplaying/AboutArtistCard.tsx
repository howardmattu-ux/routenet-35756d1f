import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { searchArtist } from "@/services/deezer";

/** Spotify-style "About the artist" card for the desktop right panel. */
export function AboutArtistCard({ artist }: { artist: string }) {
  const navigate = useNavigate();
  const main = artist.split(/,|&| feat\.? | ft\.? | x /i)[0].trim();
  const { data } = useQuery({
    queryKey: ["about-artist", main],
    queryFn: async () => (await searchArtist(main, 1).catch(() => []))[0] || null,
    enabled: !!main,
    staleTime: 60 * 60 * 1000,
  });
  const pic = data?.picture_xl || data?.picture_big || data?.picture_medium;
  const fans = Number(data?.nb_fan || 0);

  return (
    <div className="mt-4 overflow-hidden rounded-lg bg-secondary">
      <button onClick={() => navigate(`/artist/${encodeURIComponent(main)}`)} className="relative block aspect-[4/3] w-full text-left">
        {pic ? <img src={pic} alt={main} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-muted" />}
        <span className="absolute left-3 top-3 text-sm font-bold text-foreground [text-shadow:0_1px_8px_hsl(0_0%_0%/0.7)]">About the artist</span>
      </button>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-foreground">{data?.name || main}</p>
            {fans > 0 && <p className="text-xs text-muted-foreground">{fans.toLocaleString()} monthly fans</p>}
            {Number(data?.nb_album || 0) > 0 && <p className="text-xs text-muted-foreground">{data.nb_album} albums</p>}
          </div>
          <button onClick={() => navigate(`/artist/${encodeURIComponent(main)}`)} className="shrink-0 rounded-full border border-muted-foreground/50 px-4 py-1 text-xs font-bold text-foreground hover:border-foreground">
            Follow
          </button>
        </div>
      </div>
    </div>
  );
}
