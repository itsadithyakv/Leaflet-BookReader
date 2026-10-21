/**
 * The Studio voice: a voice of Leaflet's own (Kokoro), downloaded on request
 * in Settings and run on the device. The pack (its download, its files, the
 * self-test) is the Rust side's on every platform (`src-tauri/src/tts`); the
 * sound is made in Rust on Windows (`neuralEngine.ts`) and in Kotlin on
 * Android. The command and event shapes are in `src-tauri/src/tts/mod.rs`.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SpeechVoice } from "./engine";

export type StudioMode = "live" | "prepare" | "tooSlow";

export type StudioVoiceStatus = {
  pack: string;
  installed: boolean;
  downloading: boolean;
  /** What the download costs, in bytes. */
  downloadBytes: number;
  /** What it takes on disk once installed. */
  installedBytes: number;
  /** Half-downloaded, kept to resume. */
  partialBytes: number;
  dir: string;
  variant: string;
  voices: { id: string; name: string; sid: number; lang: string }[];
  defaultVoice: string;
  selfTest: { rtf: number; threads: number; platform: string; at: string } | null;
  /** Slower than it should be (RTF over 0.8): offered, never picked by itself. */
  slow: boolean;
  /** How it reads here: as it goes, preparing each chapter first, or too slow to offer. */
  mode: StudioMode;
  /** This build makes the sound itself (Windows). */
  canSpeak: boolean;
};

export type StudioProgress = { phase: "download" | "verify" | "extract" | "install" | "test"; done: number; total: number };

/** How a Studio voice's id begins. */
export const STUDIO_PREFIX = "neural:";
export const isStudioVoice = (id: string | null | undefined) => Boolean(id?.startsWith(STUDIO_PREFIX));

/** Roughly what the pack takes once installed (shown before the status has come). */
export const STUDIO_APPROX_BYTES = 367_000_000;

/** The calls it makes (a fake in the tests). */
export type StudioBridge = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
};

export const tauriBridge: StudioBridge = {
  invoke: (command, args) => invoke(command, args),
  listen: (event, handler) => listen(event, (message) => handler(message.payload as never))
};

export const studioAvailable = () => typeof window !== "undefined" && isTauri();

/**
 * The voices to list from a status: installed, offered here, and not too
 * slow. Until a self-test has passed here they are listed but never picked by
 * themselves (`untested`): a voice that has not been heard to work is not the
 * one a reading starts in.
 */
export const studioVoices = (status: StudioVoiceStatus | null): SpeechVoice[] => {
  if (!status?.installed || status.mode === "tooSlow") return [];
  return status.voices.map((voice) => ({
    id: voice.id,
    name: voice.name,
    lang: voice.lang,
    quality: 500,
    studio: true,
    ...(status.slow ? { slow: true } : {}),
    ...(status.selfTest ? {} : { untested: true })
  }));
};

export const studioService = (bridge: StudioBridge = tauriBridge) => ({
  status: () => bridge.invoke<StudioVoiceStatus>("studio_voice_status"),
  /** Resolves when installed; rejects with "cancelled" when cancelled. */
  async download(onProgress?: (progress: StudioProgress) => void): Promise<StudioVoiceStatus> {
    const stop = onProgress ? await bridge.listen<StudioProgress>("studio-voice:progress", onProgress) : () => {};
    try {
      return await bridge.invoke<StudioVoiceStatus>("studio_voice_download");
    } finally {
      stop();
    }
  },
  cancel: () => bridge.invoke<void>("studio_voice_cancel"),
  /** The bytes freed. */
  remove: () => bridge.invoke<number>("studio_voice_remove"),
  selfTest: () => bridge.invoke<StudioVoiceStatus>("studio_voice_self_test"),
  /** One sample sentence in this voice at this speed (Settings' ▶). */
  preview: (voice: string, rate: number) => bridge.invoke<void>("studio_preview", { voice, rate }),
  stopPreview: () => bridge.invoke<void>("studio_stop")
});

export type StudioService = ReturnType<typeof studioService>;

/** "367 MB". */
export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
};

/** A thrown command error as a sentence (Tauri rejects with the string). */
export const studioError = (error: unknown) =>
  typeof error === "string" ? error : error instanceof Error ? error.message : "Something went wrong";
