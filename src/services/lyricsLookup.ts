import { supabase } from "@/integrations/supabase/client";

export interface LyricsResult { lyrics: string | null; syncedLyrics?: string | null }

const TAG_RE = /\s*[([](?:[^)\]]*?(?:instrumental|karaoke|acoustic|backing track|long intro|intro|extended|official|music video|video|audio|lyrics?|visuali[sz]er|slowed|reverb|sped up|nightcore|8d|clean|dirty|explicit|radio edit|edit|remaster(?:ed)?|hd|hq|4k|live|remix|version|prod\.?)[^)\]]*?)[)\]]/gi;

/** Strip edit/version tags so instrumentals, edits and remixes still find the original lyrics. */
export function cleanSongTitle(title: string): string {
  let t = title.replace(TAG_RE, "");
  t = t.replace(/\s+-\s+(?:instrumental|karaoke.*|acoustic.*|slowed.*|sped up.*|remix.*|extended.*|radio edit|.*version)$/i, "");
  t = t.replace(/\s*(?:feat\.?|ft\.?|featuring)\s.*$/i, "");
  return t.replace(/\s{2,}/g, " ").trim() || title;
}

export function primaryArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|\bwith\b|\/)\s*/i)[0]?.trim() || artist;
}

const has = (d?: LyricsResult | null) => !!(d?.syncedLyrics || d?.lyrics);

async function call(title: string, artist: string): Promise<LyricsResult | null> {
  const { data, error } = await supabase.functions.invoke("lyrics", { body: { title, artist } });
  if (error) return null;
  return data as LyricsResult;
}

/** Try the original title first, then a cleaned title with the main artist. */
export async function fetchLyrics(title: string, artist: string): Promise<LyricsResult> {
  const first = await call(title, artist);
  if (has(first)) return first!;
  const ct = cleanSongTitle(title);
  const pa = primaryArtist(artist);
  if (ct !== title || pa !== artist) {
    const second = await call(ct, pa);
    if (has(second)) return second!;
  }
  return { lyrics: null, syncedLyrics: null };
}
