/**
 * What the radio remembers on this device: whether it plays while a book is
 * open, which scene, how loud, and whether the rain has thunder. One key in
 * the webview's storage; it does not sync (a volume belongs to a pair of
 * speakers), and "Delete All Data" removes it (services/deviceData.ts).
 */
import { isSceneId, type SceneId } from "./scenes";

export const PREFS_KEY = "leaflet.ambience";

export type AmbiencePrefs = {
  /** Plays while a book is open. Off until the reader turns it on. */
  on: boolean;
  scene: SceneId;
  /** 0 to 1, as the slider shows it. */
  volume: number;
  /** The rain's far-off thunder. */
  thunder: boolean;
};

export const DEFAULT_PREFS: AmbiencePrefs = { on: false, scene: "rain", volume: 0.6, thunder: true };

export const clampVolume = (volume: number) => (Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_PREFS.volume);

/**
 * How loud a slider position is. The ear hears ratios, so the slider's
 * middle is a quarter of the top, not half: the lower half of its travel is
 * as useful as the upper.
 */
export const volumeGain = (volume: number) => clampVolume(volume) ** 2;

/** What was stored, made whole: anything missing or odd falls back to the default for that part. */
export const parsePrefs = (raw: string | null | undefined): AmbiencePrefs => {
  if (!raw) {
    return { ...DEFAULT_PREFS };
  }
  try {
    const stored = JSON.parse(raw) as Partial<Record<keyof AmbiencePrefs, unknown>> | null;
    if (!stored || typeof stored !== "object") {
      return { ...DEFAULT_PREFS };
    }
    return {
      on: stored.on === true,
      scene: isSceneId(stored.scene) ? stored.scene : DEFAULT_PREFS.scene,
      volume: typeof stored.volume === "number" ? clampVolume(stored.volume) : DEFAULT_PREFS.volume,
      thunder: typeof stored.thunder === "boolean" ? stored.thunder : DEFAULT_PREFS.thunder
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

export const serialisePrefs = (prefs: AmbiencePrefs) =>
  JSON.stringify({ on: prefs.on, scene: prefs.scene, volume: Math.round(clampVolume(prefs.volume) * 100) / 100, thunder: prefs.thunder });

export const readPrefs = (): AmbiencePrefs => {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

export const writePrefs = (prefs: AmbiencePrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, serialisePrefs(prefs));
  } catch {
    // Remembered for this session only.
  }
};
