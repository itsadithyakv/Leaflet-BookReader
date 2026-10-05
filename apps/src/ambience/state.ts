/**
 * When the radio sounds. It plays while a book is open (if the reader has
 * turned it on) or while its panel in Pip's room is listening; it rests when
 * the window has been out of sight, or without the keyboard, for longer than
 * a moment, and comes back with it; it stops when the book is left.
 *
 * All of it is here as plain values and functions of the time, so it can be
 * tested without a window, a clock or a speaker. The controller
 * (ambience.ts) feeds it what happens and does what it says.
 */
import type { AmbiencePrefs } from "./prefs";

/** Out of sight this long (minimised, behind another window's tab) and it rests. */
export const HIDDEN_GRACE_MS = 2000;
/**
 * In sight but without the keyboard this long (another window clicked) and
 * it rests: long enough to answer a message and come back to the page.
 */
export const BLURRED_GRACE_MS = 15000;

export type AmbienceState = {
  prefs: AmbiencePrefs;
  /** Readers with a book open. A count, so one book closing as another opens is not a gap. */
  readers: number;
  /** Radio panels in Pip's room that are listening. */
  listening: number;
  /** Since when the window has been out of sight, or without the keyboard; null while it is not. */
  hiddenSince: number | null;
  blurredSince: number | null;
};

/**
 * - "off": the reader has not turned it on, and nothing is listening.
 * - "ready": on, waiting for a book to be opened.
 * - "playing": sounding.
 * - "away": would be sounding, but the window is out of sight or out of use.
 */
export type Phase = "off" | "ready" | "playing" | "away";

export const startState = (prefs: AmbiencePrefs): AmbienceState => ({ prefs, readers: 0, listening: 0, hiddenSince: null, blurredSince: null });

/** Whether anything is asking for sound. */
export const wanted = (state: AmbienceState) => (state.prefs.on && state.readers > 0) || state.listening > 0;

/** Whether the window has been gone for longer than a moment. */
export const away = (state: AmbienceState, now: number) =>
  (state.hiddenSince !== null && now - state.hiddenSince >= HIDDEN_GRACE_MS) ||
  (state.blurredSince !== null && now - state.blurredSince >= BLURRED_GRACE_MS);

export const phaseAt = (state: AmbienceState, now: number): Phase => {
  if (!wanted(state)) {
    return state.prefs.on ? "ready" : "off";
  }
  return away(state, now) ? "away" : "playing";
};

/**
 * How long until the phase changes by itself (the moment of grace running
 * out), in milliseconds; null when nothing will change until something
 * happens.
 */
export const untilChange = (state: AmbienceState, now: number): number | null => {
  if (!wanted(state) || away(state, now)) {
    return null;
  }
  const waits = [
    state.hiddenSince !== null ? state.hiddenSince + HIDDEN_GRACE_MS - now : null,
    state.blurredSince !== null ? state.blurredSince + BLURRED_GRACE_MS - now : null
  ].filter((wait): wait is number => wait !== null);
  return waits.length > 0 ? Math.max(0, Math.min(...waits)) : null;
};

/**
 * How the radio stands, in a few words, for the label of the radio in Pip's
 * room ("Radio: playing rain"). `scene` is the scene's name as the controls
 * show it.
 */
export const statusPhrase = (phase: Phase, scene: string) => {
  const name = scene.toLowerCase();
  if (phase === "playing") {
    return `playing ${name}`;
  }
  if (phase === "away") {
    return `resting, on ${name}`;
  }
  return phase === "ready" ? `on for reading, ${name}` : "off";
};

/**
 * What the engine should be doing in a phase: sounding; quiet but kept, so
 * it comes back where it was; or put away.
 */
export const engineMode = (phase: Phase): "play" | "rest" | "stop" => (phase === "playing" ? "play" : phase === "away" ? "rest" : "stop");

// ---- what happens ---------------------------------------------------------------------

export const enterReader = (state: AmbienceState): AmbienceState => ({ ...state, readers: state.readers + 1 });

export const leaveReader = (state: AmbienceState): AmbienceState => ({ ...state, readers: Math.max(0, state.readers - 1) });

export const startListening = (state: AmbienceState): AmbienceState => ({ ...state, listening: state.listening + 1 });

export const stopListening = (state: AmbienceState): AmbienceState => ({ ...state, listening: Math.max(0, state.listening - 1) });

export const withPrefs = (state: AmbienceState, patch: Partial<AmbiencePrefs>): AmbienceState => ({ ...state, prefs: { ...state.prefs, ...patch } });

/**
 * The window as it is now. Going out of sight or losing the keyboard is
 * dated from when it was first noticed; coming back clears the date.
 */
export const windowSeen = (state: AmbienceState, seen: { hidden: boolean; focused: boolean }, now: number): AmbienceState => {
  const hiddenSince = seen.hidden ? (state.hiddenSince ?? now) : null;
  const blurredSince = seen.focused ? null : (state.blurredSince ?? now);
  return hiddenSince === state.hiddenSince && blurredSince === state.blurredSince ? state : { ...state, hiddenSince, blurredSince };
};
