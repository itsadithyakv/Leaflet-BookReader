import { invoke, isTauri } from "@tauri-apps/api/core";
import { isAndroid } from "./device";

/**
 * What only the Android side can do, for the rest of the app to call without
 * knowing how: keep the screen on, lock the rotation, hide the system bars,
 * pick and share files, open Leaflet in Google Play. Each is a no-op (or
 * answers nothing) anywhere but the Android app, so callers need not check.
 *
 * The native half is a small Tauri plugin, `leaflet-device`, in Kotlin
 * (`gen/android/.../DevicePlugin.kt`) registered from Rust (`mobile.rs`).
 */

export type RotationLock = "auto" | "portrait" | "landscape";
/** What a picker is for: it decides the file types offered. */
export type PickKind = "books" | "font";

export const onAndroid = () => isAndroid() && isTauri();

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
  }
};
