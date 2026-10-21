import { invoke, isTauri } from "@tauri-apps/api/core";
import { androidVersion, deviceNoun, isAndroid } from "./device";
import { expectTurn } from "./shape";

/**
 * What only the Android side can do, for the rest of the app to call without
 * knowing how: keep the screen on, lock the rotation, hide the system bars,
 * pick and share files, open Leaflet in Google Play or its rating sheet. Each is a no-op (or
 * answers nothing) anywhere but the Android app, so callers need not check.
 *
 * The native half is a small Tauri plugin, `leaflet-device`, in Kotlin
 * (`gen/android/.../DevicePlugin.kt`) registered from Rust (`mobile.rs`).
 */

export type RotationLock = "auto" | "portrait" | "landscape";
/** What a picker is for: it decides the file types offered. */
export type PickKind = "books" | "font";

export const onAndroid = () => isAndroid() && isTauri();

/**
 * Who decides which way up the screen may be. Pip's house and the arcade
 * hold it sideways; an open book holds the reader's own choice. The newest
 * hold wins, and when it is let go the one before it applies again (a book
 * opened from Pip's tab, then closed, gives the screen back to Pip); with
 * none, the screen turns with the phone.
 */
type Hold = { id: number; lock: RotationLock };
const holds: Hold[] = [];
let holdId = 0;
let appliedLock: RotationLock = "auto";
/**
 * Whether the screen turns when a hold asks it to. From Android 16, a tablet (600 dp or more on its short side, a
 * foldable open) lays out an app that targets it however the reader holds it, and a hold does nothing: the shell
 * waited for a turn that never came, the veil over the app for TURN_WAIT_MS each time Pip's tab was opened upright.
 */
export const holdsTurnScreen = () => !(deviceNoun() === "tablet" && androidVersion() >= 16);
const applyHolds = () => {
  const lock = holds.length > 0 ? holds[holds.length - 1].lock : "auto";
  // The screen is about to turn (or may: a hold let go is the phone's to say): the shell waits for it
  // rather than drawing the way it was for a moment (platform/shape.ts). Pip's sideways let go was the rail's flash.
  // A hold let go on a phone: it is most likely held upright again (Pip's tab is left for the library), so the shell
  // takes the sizes a turn passes through for what they are; held on its side after all, the turn is let go of.
  if (lock !== appliedLock && onAndroid() && holdsTurnScreen()) {
    if (lock !== "auto") expectTurn(lock);
    else if (deviceNoun() === "phone") expectTurn("portrait", { guess: true });
    else expectTurn(null);
  }
  appliedLock = lock;
  void call("lock_rotation", { lock });
};

/** Holds the screen one way up until the returned function is called. Use from an effect. */
export const holdRotation = (lock: RotationLock): (() => void) => {
  holdId += 1;
  const hold = { id: holdId, lock };
  holds.push(hold);
  applyHolds();
  return () => {
    const at = holds.findIndex((entry) => entry.id === hold.id);
    if (at >= 0) holds.splice(at, 1);
    applyHolds();
  };
};

/**
 * Whether the status and navigation bars are drawn for a light page (dark
 * icons) or a dark one (light icons). Android would follow the phone's dark
 * mode; Leaflet's own theme sets the look, and an open book holds its page's
 * look over that (the newest hold wins, as with the rotation).
 */
type BarHold = { id: number; light: boolean };
const barHolds: BarHold[] = [];
let appBarsLight = true;
const applyBarLook = () => {
  const light = barHolds.length > 0 ? barHolds[barHolds.length - 1].light : appBarsLight;
  void call("set_bar_look", { light });
};

/** Holds the bars' look (light: dark icons) until the returned function is called. */
export const holdBarLook = (light: boolean): (() => void) => {
  holdId += 1;
  const hold = { id: holdId, light };
  barHolds.push(hold);
  applyBarLook();
  return () => {
    const at = barHolds.findIndex((entry) => entry.id === hold.id);
    if (at >= 0) barHolds.splice(at, 1);
    applyBarLook();
  };
};

/**
 * The activity's night mode, which colours what Android draws for the page
 * (a `<select>`'s list): the app's theme, or the phone's when the app follows
 * it; an open book holds its page's over that (a True black page with a light
 * app has a dark list), the newest hold winning, as with the bars.
 */
type NightMode = "light" | "dark" | "system";
type NightHold = { id: number; mode: "light" | "dark" };
const nightHolds: NightHold[] = [];
let appNightMode: NightMode = "system";
const applyNightMode = () => {
  const mode = nightHolds.length > 0 ? nightHolds[nightHolds.length - 1].mode : appNightMode;
  void call("set_night_mode", { mode });
};

/** Holds the night mode (a dark page: "dark") until the returned function is called. */
export const holdNightMode = (mode: "light" | "dark"): (() => void) => {
  holdId += 1;
  const hold = { id: holdId, mode };
  nightHolds.push(hold);
  applyNightMode();
  return () => {
    const at = nightHolds.findIndex((entry) => entry.id === hold.id);
    if (at >= 0) nightHolds.splice(at, 1);
    applyNightMode();
  };
};

/**
 * A book holds the night mode: the WebView's `prefers-color-scheme` may say
 * the page's, not the phone's, until it lets go.
 */
export const nightModeHeld = () => nightHolds.length > 0;

/** The app's theme, for Android: the bars' look and the night mode when no book holds them. */
export const followAppTheme = (theme: "light" | "dark", followSystem: boolean) => {
  appBarsLight = theme === "light";
  applyBarLook();
  appNightMode = followSystem ? "system" : theme;
  applyNightMode();
};

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T | null> => {
  if (!onAndroid()) return null;
  try {
    return await invoke<T>(`plugin:leaflet-device|${command}`, args);
  } catch (error) {
    console.warn(`leaflet-device ${command}:`, error);
    return null;
  }
};

export const android = {
  /** The screen stays on while true (a book open and touched lately, Dotty or auto-scroll running). */
  async keepAwake(on: boolean): Promise<void> {
    await call("keep_awake", { on });
  },

  /** Keeps Leaflet from being paused while Drive's sign-in is out in the browser (SignInKeeper.kt). */
  async holdForSignIn(on: boolean): Promise<void> {
    await call("hold_for_sign_in", { on });
  },

  /** While true, the volume keys are Leaflet's and turn the open book's pages (`platform/volumeKeys.ts`). */
  async volumePageTurns(on: boolean): Promise<void> {
    await call("volume_page_turns", { on });
  },

  /** The app icon's "Continue <book>" shortcut (Shortcuts.kt; `platform/continueShortcut.ts` decides it). */
  async setContinueShortcut(shortcut: { bookId: string; shortLabel: string; longLabel: string; coverDataUrl: string | null }): Promise<void> {
    await call("set_continue_shortcut", shortcut);
  },

  async clearContinueShortcut(): Promise<void> {
    await call("clear_continue_shortcut");
  },

  /** The book a tapped "Continue" shortcut asked for, once; null when none. */
  async takeContinueShortcut(): Promise<string | null> {
    return (await call<{ bookId?: string }>("take_continue_shortcut"))?.bookId ?? null;
  },

  /**
   * The window's brightness while a book is open (0.01 to 1), or null for the
   * system's again (Brightness.kt). Answers the phone's own setting (0 to 1)
   * for a swipe to start from; null off Android.
   */
  async setBrightness(level: number | null): Promise<{ system?: number } | null> {
    return call<{ system?: number }>("set_brightness", { level });
  },

  /** Which way up the app may be: with the phone, or held one way. */
  async lockRotation(lock: RotationLock): Promise<void> {
    await call("lock_rotation", { lock });
  },

  /** Hides the status and gesture bars (focus lock, reading sideways); a swipe from the edge shows them for a moment. */
  async hideSystemBars(hidden: boolean): Promise<void> {
    await call("hide_system_bars", { hidden });
  },

  /** The system picker; what is chosen is copied into Leaflet's own storage, and those paths are returned. */
  async pickFiles(kind: PickKind, multiple = true): Promise<string[]> {
    return (await call<string[]>("pick_files", { kind, multiple })) ?? [];
  },

  /**
   * Where to write a file that is about to be shared: a fresh path named
   * `name` in Leaflet's cache (the only place `shareFile` shares from). Null
   * off Android.
   */
  async shareTarget(name: string): Promise<string | null> {
    return call<string>("share_target", { name });
  },

  /** The share sheet for a file Leaflet has written (Save to Files, Photos, Drive, a message); `path` from `shareTarget`. */
  async shareFile(path: string, mime: string, title?: string): Promise<void> {
    await call("share_file", { path, mime, title: title ?? null });
  },

  /** The share sheet for a line of text (a quote, a link). */
  async shareText(text: string, title?: string): Promise<void> {
    await call("share_text", { text, title: title ?? null });
  },

  /** Reading aloud with Android's text-to-speech (ReadAloud.kt): one command, the step named by `op`. */
  async readAloud<T = unknown>(op: string, args?: Record<string, unknown>): Promise<T | null> {
    return call<T>("read_aloud", { ...args, op });
  },

  /** Leaflet's page in Google Play (to rate it, or update it). */
  async openStore(): Promise<void> {
    await call("open_store");
  },

  /**
   * Google Play's own rating sheet, over Leaflet. Google may show nothing (a
   * quota per person, or a build not installed from Play) and does not say
   * so; when the sheet was not on screen, or Play is missing, Leaflet's page
   * in Google Play opens instead, so a tap on "Rate" always does something.
   * Asked once per call, never again.
   */
  async requestReview(): Promise<void> {
    if (!onAndroid()) return;
    const answer = await call<{ launched?: boolean; shown?: boolean }>("request_review");
    if (!answer?.launched || !answer.shown) await call("open_store");
  }
};
