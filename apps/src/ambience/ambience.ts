/**
 * The radio: rain, a fire, a cafe or plain noise behind the page while a
 * book is open. This is the one place that knows what the reader chose
 * (prefs.ts), what is going on (a book open, the panel in Pip's room
 * listening, the window in or out of sight: state.ts) and tells the engine
 * (engine.ts) what to do about it.
 *
 * It is separate from Pip's own sounds (pip/sound.ts): those are her little
 * noises and have their switch in Settings; this has its own on and off, and
 * neither changes the other.
 *
 * Nothing sounds, and no audio is even set up, until a reader with the radio
 * on opens a book, or its panel is asked to play.
 */
import { useSyncExternalStore } from "react";
import { createEngine, type EngineStatus } from "./engine";
import { clampVolume, readPrefs, writePrefs, type AmbiencePrefs } from "./prefs";
import { SCENES, type SceneId } from "./scenes";
import {
  engineMode,
  enterReader,
  leaveReader,
  phaseAt,
  startListening,
  statusPhrase,
  startState,
  stopListening,
  untilChange,
  windowSeen,
  withPrefs,
  type AmbienceState,
  type Phase
} from "./state";

/** What the controls and Pip's room draw from. */
export type AmbienceView = {
  /** The reader has it on: it plays whenever a book is open. */
  on: boolean;
  scene: SceneId;
  sceneName: string;
  volume: number;
  thunder: boolean;
  phase: Phase;
  /** Sounding this moment (a book open with it on, or the panel listening, and the window in use). */
  playing: boolean;
  /** The panel in Pip's room is listening. */
  listening: boolean;
};

let state: AmbienceState = startState(readPrefs());
const engine = createEngine();
const listeners = new Set<() => void>();
let checkTimer: number | null = null;
let watching = false;

const viewOf = (current: AmbienceState, now: number): AmbienceView => {
  const phase = phaseAt(current, now);
  return {
    on: current.prefs.on,
    scene: current.prefs.scene,
    sceneName: SCENES[current.prefs.scene].name,
    volume: current.prefs.volume,
    thunder: current.prefs.thunder,
    phase,
    playing: phase === "playing",
    listening: current.listening > 0
  };
};

const sameView = (a: AmbienceView, b: AmbienceView) =>
  a.on === b.on && a.scene === b.scene && a.volume === b.volume && a.thunder === b.thunder && a.phase === b.phase && a.listening === b.listening;

let view: AmbienceView = viewOf(state, Date.now());
// Before anything has been asked of it: what was stored, and silence.
const serverView: AmbienceView = { ...view, phase: "off", playing: false, listening: false };

/** Works out the phase as of now, tells the engine, and comes back when a moment of grace runs out. */
const settle = () => {
  const now = Date.now();
  const next = viewOf(state, now);
  engine.sync({ scene: state.prefs.scene, volume: state.prefs.volume, thunder: state.prefs.thunder, mode: engineMode(next.phase) });
  if (checkTimer !== null) {
    window.clearTimeout(checkTimer);
    checkTimer = null;
  }
  const wait = untilChange(state, now);
  if (wait !== null && typeof window !== "undefined") {
    checkTimer = window.setTimeout(() => {
      checkTimer = null;
      settle();
    }, wait + 20);
  }
  if (!sameView(view, next)) {
    view = next;
    listeners.forEach((listener) => listener());
  }
};

/** The state with the window as it is this moment. */
const withWindow = (current: AmbienceState) =>
  typeof document === "undefined"
    ? current
    : // `hasFocus` rather than the blur event's word: the book's text is in a
      // frame of its own, and a click into it "blurs" the window that holds it.
      windowSeen(current, { hidden: document.visibilityState === "hidden", focused: document.hasFocus() }, Date.now());

const lookAtWindow = () => {
  const next = withWindow(state);
  if (next !== state) {
    state = next;
    settle();
  }
};

/** Starts watching the window, the first time anything wants sound. */
const watch = () => {
  if (watching || typeof window === "undefined") {
    return;
  }
  watching = true;
  document.addEventListener("visibilitychange", lookAtWindow);
  // After the event, when the document knows where the keyboard went.
  const later = () => window.setTimeout(lookAtWindow, 0);
  window.addEventListener("blur", later);
  window.addEventListener("focus", later);
};

/**
 * What is stored, read again. Storage is where the choices live: after
 * "Delete All Data" has removed them, the next book opens to a radio that is
 * off, not to what this session remembered.
 */
const reread = (current: AmbienceState): AmbienceState => {
  const stored = readPrefs();
  const kept = current.prefs;
  return stored.on === kept.on && stored.scene === kept.scene && stored.volume === kept.volume && stored.thunder === kept.thunder
    ? current
    : { ...current, prefs: stored };
};

const change = (next: AmbienceState, remember = true) => {
  const prefsChanged = next.prefs !== state.prefs;
  state = withWindow(next);
  if (prefsChanged && remember) {
    writePrefs(state.prefs);
  }
  watch();
  settle();
};

export const ambience = {
  /** A reader has a book open. */
  enterReader: () => change(enterReader(reread(state)), false),
  /** The book is closed: the sound fades and stops. */
  leaveReader: () => change(leaveReader(state)),
  /** The radio's panel in Pip's room starts, or stops, playing what is chosen. */
  startListening: () => change(startListening(reread(state)), false),
  stopListening: () => change(stopListening(state)),
  /** Plays while a book is open, or not. */
  setOn: (on: boolean) => change(withPrefs(state, { on })),
  /** Picks a scene; with `on`, turns the radio on (or off) for reading as well. */
  chooseScene: (scene: SceneId, on?: boolean) => change(withPrefs(state, on === undefined ? { scene } : { scene, on })),
  setVolume: (volume: number) => change(withPrefs(state, { volume: clampVolume(volume) })),
  setThunder: (thunder: boolean) => change(withPrefs(state, { thunder })),
  view: () => view,
  /** The engine as it is: for measuring in development, not for the app. */
  status: (): EngineStatus => engine.status(),
  prefs: (): AmbiencePrefs => state.prefs
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The radio as it is now, for anything that draws it: the controls, and
 * Pip's room (lit when `on`, sounding when `playing`).
 */
export const useAmbienceState = (): AmbienceView =>
  useSyncExternalStore(
    subscribe,
    () => view,
    () => serverView
  );

/** What the radio in Pip's room shows: small, plain, and the same object for as long as nothing in it changes. */
export type RadioThing = {
  /** For its label: "playing rain", "on for reading, cafe", "off". */
  status: string;
  /** For its picture: lit while it is on for reading or sounding, notes rising while it sounds. */
  art: { on: boolean; playing: boolean; scene: SceneId };
};

let radioThing: RadioThing | null = null;
let radioThingOf: AmbienceView | null = null;

const radioOf = (current: AmbienceView): RadioThing => {
  if (!radioThing || radioThingOf !== current) {
    radioThingOf = current;
    radioThing = {
      status: statusPhrase(current.phase, current.sceneName),
      art: { on: current.on || current.playing, playing: current.playing, scene: current.scene }
    };
  }
  return radioThing;
};

/** The radio, for the room that draws it and names it (components/pip/roomThings.tsx). */
export const useRadioThing = (): RadioThing =>
  useSyncExternalStore(
    subscribe,
    () => radioOf(view),
    () => radioOf(serverView)
  );

// In development the radio can be reached from the console, as the reader's
// rendition can (`window.__leafletRendition`), to measure what it is doing.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __leafletAmbience?: unknown }).__leafletAmbience = { ...ambience, state: () => state };
}
