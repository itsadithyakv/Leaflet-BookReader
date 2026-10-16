import { create } from "zustand";
import { android, onAndroid } from "../platform/android";
import { brightnessOutput, levelFromSystem, readLight, roundLevel, writeLight, type LightKind, type LightLevels } from "./readingLight";

/**
 * The reader's light, shared by the swipes at the page's edges, the sliders
 * in Text settings and the veils over the page (readers/readingLight.ts).
 * Kept per device; the window's brightness is the reader's only while a book
 * is open (`enterReader`, `leaveReader`).
 */
type LightState = LightLevels & {
  /** The phone's own brightness (0 to 1), as Android last said; null until it has. */
  system: number | null;
  /** The pill showing the level being set; null when it is away. */
  pill: LightKind | null;
  /** A finger is setting it now (the pill waits to fade until it lifts). */
  pillHeld: boolean;
  /** Bumped by anything that should keep the pill up a moment longer. */
  pillStamp: number;
};

const kept = readLight();

export const useReadingLight = create<LightState>(() => ({
  ...kept,
  system: null,
  pill: null,
  pillHeld: false,
  pillStamp: 0
}));

/** Whether the window's own brightness can be set (the Android app). */
export const hasScreenBrightness = () => onAndroid();

// One call to Android at a time: a swipe asks for a new level every frame, and
// only the newest of those waiting is worth sending.
let sending = false;
let waiting: { level: number | null } | null = null;

const flush = async () => {
  if (sending) {
    return;
  }
  sending = true;
  try {
    while (waiting) {
      const { level } = waiting;
      waiting = null;
      const answer = await android.setBrightness(level);
      if (typeof answer?.system === "number" && Number.isFinite(answer.system)) {
        useReadingLight.setState({ system: answer.system });
      }
    }
  } finally {
    sending = false;
  }
};

/** Asks Android for this window brightness (null: the system's). */
const sendScreen = (level: number | null) => {
  if (!hasScreenBrightness()) {
    return;
  }
  waiting = { level };
  void flush();
};

const screenFor = (brightness: number | null) => brightnessOutput(brightness, hasScreenBrightness()).screen;

const levelsNow = (): LightLevels => {
  const { brightness, warmth } = useReadingLight.getState();
  return { brightness, warmth };
};

/** A book has opened: the window takes the kept brightness (and Android says what its own is). */
export const enterReader = () => {
  sendScreen(screenFor(useReadingLight.getState().brightness));
};

/** The book has closed: the window follows the system again, and the pill goes. */
export const leaveReader = () => {
  useReadingLight.setState({ pill: null, pillHeld: false });
  sendScreen(null);
};

/** The level a swipe starts from: the kept one, or (following the system) the phone's own. */
export const startLevel = (kind: LightKind) => {
  const state = useReadingLight.getState();
  if (kind === "warmth") {
    return state.warmth;
  }
  return state.brightness ?? levelFromSystem(state.system, hasScreenBrightness());
};

/** A level set (by a swipe while `held`, or a slider): applied at once; kept when the finger lifts. */
export const setLight = (kind: LightKind, level: number, options: { held?: boolean; pill?: boolean } = {}) => {
  const value = roundLevel(level);
  const state = useReadingLight.getState();
  const pill = options.pill === false ? state.pill : kind;
  if (kind === "brightness") {
    if (value !== state.brightness) {
      useReadingLight.setState({ brightness: value });
      sendScreen(screenFor(value));
    }
  } else if (value !== state.warmth) {
    useReadingLight.setState({ warmth: value });
  }
  useReadingLight.setState({ pill, pillHeld: Boolean(options.held), pillStamp: state.pillStamp + 1 });
  if (!options.held) {
    writeLight(levelsNow());
  }
};

/** The finger has lifted: the level is kept, and the pill fades. */
export const releaseLight = () => {
  const state = useReadingLight.getState();
  useReadingLight.setState({ pillHeld: false, pillStamp: state.pillStamp + 1 });
  writeLight(levelsNow());
};

/** Back to the system's brightness, or to no warmth. */
export const resetLight = (kind: LightKind, options: { pill?: boolean } = {}) => {
  const state = useReadingLight.getState();
  if (kind === "brightness") {
    useReadingLight.setState({ brightness: null });
    sendScreen(null);
  } else {
    useReadingLight.setState({ warmth: 0 });
  }
  useReadingLight.setState({ pill: options.pill === false ? state.pill : kind, pillHeld: false, pillStamp: state.pillStamp + 1 });
  writeLight(levelsNow());
};

/** The pill has faded away. */
export const hideLightPill = () => useReadingLight.setState({ pill: null, pillHeld: false });

/** Keeps the pill up a moment longer (a finger on it). */
export const holdLightPill = () => {
  const state = useReadingLight.getState();
  useReadingLight.setState({ pillStamp: state.pillStamp + 1 });
};

/** For tests: the levels kept, and nothing waiting for Android. */
export const resetLightForTests = (levels: LightLevels = readLight()) => {
  waiting = null;
  sending = false;
  useReadingLight.setState({ ...levels, system: null, pill: null, pillHeld: false, pillStamp: 0 });
};
