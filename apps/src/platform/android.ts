import { invoke, isTauri } from "@tauri-apps/api/core";
import { isAndroid } from "./device";

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
const applyHolds = () => {
  void call("lock_rotation", { lock: holds.length > 0 ? holds[holds.length - 1].lock : "auto" });
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
