import { useEffect, useMemo, useRef, useState } from "react";
import { Home, Search, X, FolderOpen, Bell, Users, Radio, ArrowDownCircle, ArrowUp, ArrowDown, PlusCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppLogo } from "@/components/brand/AppLogo";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedSearch, useSearchMusic, useUnifiedTrackSearch } from "@/hooks/useMusicSearch";
import { usePlayer } from "@/context/PlayerContext";
import type { Track } from "@/data/mockData";
import { cn } from "@/lib/utils";

type Row =
  | { kind: "suggest"; text: string }
  | { kind: "track"; track: Track }
  | { kind: "artist"; id: string; name: string; image: string }
  | { kind: "album"; id: string; title: string; artist: string; image: string };

const PH = "/placeholder.svg";
const onImgErr = (e: React.SyntheticEvent<HTMLImageElement>) => { if (!e.currentTarget.src.endsWith(PH)) e.currentTarget.src = PH; };

/** Full-width Spotify-style top bar: logo, round Home button, pill search with inline dropdown. */
export function DesktopTopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { playTrack, addToQueue } = usePlayer();
  const { query: q, debouncedQuery, setQuery: setQ } = useDebouncedSearch(250, "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const onHome = location.pathname === "/home" || location.pathname === "/";

  const { data: tracks } = useUnifiedTrackSearch(debouncedQuery);
  const { data: music } = useSearchMusic(debouncedQuery);

  const rows: Row[] = useMemo(() => {
    if (debouncedQuery.trim().length < 2) return [];
    const t = (tracks || []) as Track[];
    const lower = debouncedQuery.toLowerCase();
    const sugg = [...new Set([lower, ...t.slice(0, 6).map((x) => x.title.toLowerCase()).filter((x) => x.includes(lower.split(" ")[0]))])].slice(0, 4);
    const out: Row[] = sugg.map((text) => ({ kind: "suggest", text }));
    const a = (music as any)?.artists?.[0];
    if (a) out.push({ kind: "artist", id: String(a.id), name: a.name, image: a.avatar || PH });
    (music as any)?.albums?.slice(0, 2).forEach((al: any) => out.push({ kind: "album", id: String(al.id), title: al.name, artist: al.artist, image: al.artwork || PH }));
    t.slice(0, 5).forEach((track) => out.push({ kind: "track", track }));
    return out;
  }, [debouncedQuery, tracks, music]);

  useEffect(() => { setActive(-1); }, [debouncedQuery]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const goFullSearch = (value: string) => {
    sessionStorage.setItem("rn_pending_q", value);
    window.dispatchEvent(new CustomEvent("rn-search", { detail: value }));
    setOpen(false);
    if (location.pathname !== "/search") navigate("/search");
  };

  const choose = (r: Row) => {
    if (r.kind === "suggest") { setQ(r.text); goFullSearch(r.text); return; }
    setOpen(false);
    if (r.kind === "track") playTrack(r.track, ((tracks || []) as Track[]));
    if (r.kind === "artist") navigate(`/artist/${encodeURIComponent(r.name)}`);
    if (r.kind === "album") navigate(`/album/${r.id}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
    else if (e.key === "Enter") { if (active >= 0 && rows[active]) choose(rows[active]); else if (q.trim()) goFullSearch(q.trim()); }
    else if (e.key === "Escape") setOpen(false);
  };

  const initial = (user?.email || "R").charAt(0).toUpperCase();

  return (
    <header className="hidden h-16 shrink-0 items-center gap-2 bg-background px-4 lg:flex">
      <AppLogo className="h-9 w-9 rounded-full" />
      <div className="flex flex-1 items-center justify-center gap-2">
        <button
          onClick={() => navigate("/home")}
          aria-label="Home"
          className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary transition-transform hover:scale-105", onHome ? "text-foreground" : "text-muted-foreground")}
        >
          <Home className="h-7 w-7" fill={onHome ? "currentColor" : "none"} />
        </button>
        <div ref={boxRef} className="relative w-full max-w-[480px]">
          <div className={cn("flex h-12 w-full items-center gap-3 rounded-full bg-secondary px-4 transition-shadow hover:bg-muted", open && rows.length ? "ring-2 ring-foreground" : "focus-within:ring-2 focus-within:ring-foreground")}>
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKey}
              placeholder="What do you want to play?"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {q && (
              <button onClick={() => { setQ(""); setOpen(false); }} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            )}
            <span className="h-6 w-px bg-border" />
            <button onClick={() => navigate("/browse")} aria-label="Browse" className="text-muted-foreground hover:text-foreground">
              <FolderOpen className="h-5 w-5" />
            </button>
          </div>

          {open && rows.length > 0 && (
            <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[70vh] overflow-y-auto rounded-lg bg-popover p-2 shadow-2xl">
              <div className="flex items-center justify-between px-2 pb-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ArrowUp className="h-5 w-5 rounded border border-border p-0.5" />
                  <ArrowDown className="h-5 w-5 rounded border border-border p-0.5" /> Navigate
                </span>
                <span className="flex items-center gap-1.5"><kbd className="rounded border border-border px-1.5 py-0.5 font-sans">Enter</kbd> Search</span>
              </div>
              {rows.map((r, i) => {
                const hl = i === active ? "bg-white/10" : "hover:bg-white/5";
                if (r.kind === "suggest") {
                  const head = r.text.slice(0, debouncedQuery.length);
                  return (
                    <button key={`s-${r.text}`} onMouseEnter={() => setActive(i)} onClick={() => choose(r)} className={cn("flex w-full items-center gap-4 rounded-md px-2 py-2 text-left", hl)}>
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center"><Search className="h-5 w-5 text-muted-foreground" /></span>
                      <span className="truncate text-[15px] text-foreground"><b>{head}</b>{r.text.slice(head.length)}</span>
                    </button>
                  );
                }
                const img = r.kind === "track" ? (r.track.artwork || PH) : r.image;
                const title = r.kind === "track" ? r.track.title : r.kind === "artist" ? r.name : r.title;
                const sub = r.kind === "track" ? `Song • ${r.track.artist}` : r.kind === "artist" ? "Artist" : `Album • ${r.artist}`;
                return (
                  <div key={`${r.kind}-${i}`} onMouseEnter={() => setActive(i)} onClick={() => choose(r)} className={cn("flex cursor-pointer items-center gap-4 rounded-md px-2 py-2", hl)}>
                    <img src={img} onError={onImgErr} alt="" loading="lazy" className={cn("h-12 w-12 shrink-0 object-cover", r.kind === "artist" ? "rounded-full" : "rounded")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-foreground">{title}</span>
                      <span className="block truncate text-sm text-muted-foreground">{sub}</span>
                    </span>
                    {r.kind === "track" && (
                      <button aria-label="Add to queue" onClick={(e) => { e.stopPropagation(); addToQueue(r.track); }} className="text-muted-foreground hover:text-foreground">
                        <PlusCircle className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <button onClick={() => navigate("/radio")} aria-label="Radio" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-transform hover:scale-105 hover:text-foreground">
          <Radio className="h-5 w-5" />
        </button>
      </div>
      <button onClick={() => navigate("/premium")} className="hidden h-8 rounded-full bg-foreground px-4 text-sm font-bold text-background transition-transform hover:scale-105 xl:block">
        Explore Premium
      </button>
      <button onClick={() => navigate("/settings")} className="hidden items-center gap-1.5 px-2 text-sm font-bold text-muted-foreground hover:text-foreground xl:flex">
        <ArrowDownCircle className="h-4 w-4" /> Install App
      </button>
      <button aria-label="What's new" className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"><Bell className="h-5 w-5" /></button>
      <button aria-label="Friend activity" className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"><Users className="h-5 w-5" /></button>
      <button
        onClick={() => navigate(user ? "/profile" : "/auth")}
        aria-label="Profile"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{initial}</span>
      </button>
    </header>
  );
}
