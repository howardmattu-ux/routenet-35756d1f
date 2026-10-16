/**
 * Scene lock — keeps country-specific scenes (Kenyan drill / Arbantone /
 * Gengetone / Sheng rap) inside their own scene. Global rap and every other
 * genre never touch this: it only switches on for a Kenyan seed.
 */
export const KENYAN_SCENE: string[] = [
  "Buruklyn Boyz", "Wakadinali", "Scar Mkadinali", "Sewersydaa", "Domani Munga", "Toxic Lyrikali", "Toxic Lyrical",
  "Mejja", "Boutross", "Trio Mio", "Ssaru", "Breeder LW", "Ajay", "Rekles", "Exray", "Octopizzo", "Khaligraph Jones",
  "Matata", "Smply T", "Kushman", "Lil Maina", "Mr Right", "Mbithi", "Shalkido", "Dyana Cods", "Kristoff",
  "Ethic Entertainment", "Sailors Gang", "Mbogi Genje", "Gody Tennor", "Femi One", "Nviiri The Storyteller",
  "Bensoul", "Savara", "Sauti Sol", "Nyashinski", "Bien", "Willy Paul", "Bahati", "Kayvo Kforce", "Jovie Jovv",
  "Mauru Gwash", "Thirtyfourbrick", "Swat Matire", "Iyanii", "Fathermoh", "Joefes", "Kahush", "Mondi Kei",
  "Jabidii", "Watendawili", "Vic West", "Kaa La Moto", "Brandy Maina", "Elisha Toto", "Lexxy Yung", "Ochungulo Family",
  "Zzero Sufuri", "Gwaash", "Bryan Mayhem", "Kappa Jiwe", "Hype Ballo", "Tipsy Gee", "Odi wa Murang'a",
  "Nikita Kering", "Bensoul", "Okello Max", "Xenia Manasseh", "Breeder", "Dufla Diligon", "Motif The Ruler",
];

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ROSTER = new Set(KENYAN_SCENE.map(norm));

/** Split "A, B & C feat. D" into individual artist names. */
export function splitArtists(artist: string): string[] {
  return (artist || "").split(/,|&|\bx\b|\bft\.?|\bfeat\.?|\bwith\b/i).map((a) => a.trim()).filter(Boolean);
}

export function isKenyanArtist(artist: string): boolean {
  return splitArtists(artist).some((a) => ROSTER.has(norm(a)));
}

const SCENE_WORDS = /\b(arbantone|gengetone|kenyan drill|kenya drill|sheng|nairobi|kenya)\b/i;

/** True when the seed belongs to the Kenyan scene. */
export function isKenyanSeed(seed: { title?: string; artist?: string; album?: string } | null): boolean {
  if (!seed) return false;
  return isKenyanArtist(seed.artist || "") || SCENE_WORDS.test(`${seed.title ?? ""} ${seed.album ?? ""}`);
}

/** Keep only candidates by Kenyan scene artists. */
export function keepKenyanOnly<T extends { artist: string }>(list: T[]): T[] {
  return list.filter((c) => isKenyanArtist(c.artist));
}
