import { useEffect, useState } from "react";

// Single source of truth for crossfade settings. The old AutoMix key is
// reused for on/off so existing toggles keep working.
const ON_KEY = "tunestream_automix_enabled";
const SEC_KEY = "routenet_crossfade_seconds";
const SYNC_KEY = "routenet_crossfade_sync";
const EVT = "crossfade-prefs-changed";

export interface CrossfadePrefs { enabled: boolean; seconds: number; sync: boolean }

export function getCrossfade(): CrossfadePrefs {
  try {
    const s = Number(localStorage.getItem(SEC_KEY) || 8);
    return {
      enabled: localStorage.getItem(ON_KEY) === "true",
      seconds: Math.min(15, Math.max(1, Number.isFinite(s) ? s : 8)),
      sync: localStorage.getItem(SYNC_KEY) === "true",
    };
  } catch {
    return { enabled: false, seconds: 8, sync: false };
  }
}

export function setCrossfade(patch: Partial<CrossfadePrefs>) {
  try {
    if (patch.enabled !== undefined) localStorage.setItem(ON_KEY, String(patch.enabled));
    if (patch.seconds !== undefined) localStorage.setItem(SEC_KEY, String(Math.min(15, Math.max(1, Math.round(patch.seconds)))));
    if (patch.sync !== undefined) localStorage.setItem(SYNC_KEY, String(patch.sync));
  } catch {}
  window.dispatchEvent(new Event(EVT));
}

export function useCrossfade(): [CrossfadePrefs, (p: Partial<CrossfadePrefs>) => void] {
  const [prefs, setPrefs] = useState(getCrossfade);
  useEffect(() => {
    const h = () => setPrefs(getCrossfade());
    window.addEventListener(EVT, h);
    window.addEventListener("storage", h);
    return () => { window.removeEventListener(EVT, h); window.removeEventListener("storage", h); };
  }, []);
  return [prefs, setCrossfade];
}
