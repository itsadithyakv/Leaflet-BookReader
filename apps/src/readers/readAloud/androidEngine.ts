/**
 * Reading aloud on Android: the phone's own text-to-speech, in Kotlin
 * (`ReadAloud.kt`), which keeps the queue, plays on with the screen off
 * (a media-playback service with its notification and lock-screen
 * controls), and pauses for a call, other audio or unplugged headphones.
 * What happens there comes back through `window.__leafletReadAloud`, which
 * the Kotlin side calls as `__leafletBack` is called.
 *
 * Leaflet's own Studio voice (ids "neural:…", `StudioVoice.kt`) is behind the
 * same engine: the same items, with their sentences' `marks`, and it says
 * where it is a sentence at a time. On a phone too slow to read it live it
 * prepares the chapter first: it asks for the rest of the chapter queued
 * (`ahead`), says how long until it starts ("preparing"), and can prepare
 * before reading starts (`prepare`).
 */
import { invoke } from "@tauri-apps/api/core";
import { android, onAndroid } from "../../platform/android";
import { eventHub, toEngineEvent, type SpeechEngine, type SpeechItem, type SpeechVoice } from "./engine";
import { isStudioVoice } from "./studioVoice";

declare global {
  interface Window {
    /** Called by the Android side as the voice reads (ReadAloud.kt). */
    __leafletReadAloud?: (event: unknown) => void;
  }
}

export { isStudioVoice };

/** Sentences queued ahead while a Studio voice prepares the chapter first: the rest of the chapter and the start of the next (as on Windows). */
export const PREPARE_AHEAD = 600;

export const androidSpeechAvailable = () => onAndroid();

/** Opens Android's text-to-speech settings (where a voice is added). */
export const openSpeechSettings = () => void android.readAloud("settings");

/** What the Kotlin side sends, as an `EngineEvent` (anything malformed or unknown is dropped). */
export { toEngineEvent };

/** An item as the Kotlin side reads it (only what it uses). */
export const toWireItem = (item: SpeechItem) => ({
  id: item.id,
  text: item.text,
  ...(item.silence ? { silence: item.silence } : {}),
  ...(item.marks && item.marks.length > 0 ? { marks: item.marks } : {}),
  ...(item.phonemes && item.phonemes.length > 0 ? { phonemes: item.phonemes } : {})
});

export const androidEngine = (): SpeechEngine => {
  const hub = eventHub();
  window.__leafletReadAloud = (raw) => {
    const event = toEngineEvent(raw);
    if (event) hub.emit(event);
  };
  const send = (op: string, args?: Record<string, unknown>) => void android.readAloud(op, args);
  let voiceId: string | null = null;
  let rate = 1;
  /** The Studio voices that prepare the chapter first on this phone (from the last voice list). */
  const slow = new Set<string>();
  return {
    kind: "android",
    /** The Studio voice says each sentence as it is heard (at its marks); the phone's voice, as it does (often each word). */
    get progress() {
      return isStudioVoice(voiceId) ? ("sentence" as const) : undefined;
    },
    ahead: () => (isStudioVoice(voiceId) && slow.has(voiceId ?? "") ? PREPARE_AHEAD : null),
    async voices(): Promise<SpeechVoice[]> {
      const answer = await android.readAloud<{ voices?: SpeechVoice[] }>("voices");
      const list = Array.isArray(answer?.voices) ? answer.voices : [];
      slow.clear();
      for (const voice of list) if (voice.studio && voice.slow) slow.add(voice.id);
      return list;
    },
    speak(items, { replace }) {
      send("speak", { items: items.map(toWireItem), replace });
    },
    prepare(items, { bookId }) {
      if (!isStudioVoice(voiceId) || items.length === 0) return;
      send("prepare", { items: items.map(toWireItem), voice: voiceId, rate, ...(bookId ? { bookId } : {}) });
    },
    forget: () => send("forget"),
    pause: () => send("pause"),
    resume: () => send("resume"),
    stop: () => send("stop"),
    setRate: (next) => {
      rate = next;
      send("rate", { rate: next });
    },
    setVoice: (id, lang) => {
      voiceId = id;
      send("voice", { voice: id, language: lang });
    },
    setInfo: (info) => send("info", info),
    onEvent: hub.on
  };
};

/** What the Studio voice can do on this phone (`StudioVoice.support`); null off Android. */
export type AndroidStudioSupport = {
  /** Its native libraries are in this build (arm64; x86_64 in debug builds). */
  native: boolean;
  /** The pack is downloaded (its install.json is there). */
  installed: boolean;
  abi: string;
  /** Too little memory for it (it takes about 800 MB): not offered. */
  lowRam: boolean;
  /** Seconds of work per second of speech, as last measured; null before the self-test. */
  rtf: number | null;
  /** live (r <= 0.85), prepare (up to 2.5: it prepares a chapter before it starts), off (slower: not offered). */
  mode: "live" | "prepare" | "off" | null;
  threads: number;
  /** Why it could not start, when it could not. */
  broken: string | null;
  dir: string;
};

export const androidStudioSupport = () => android.readAloud<AndroidStudioSupport>("studio");

/** Whether a download now would be on a metered network (mobile data): ask before the pack's few hundred MB. */
export const androidOnMeteredNetwork = async () => Boolean((await android.readAloud<{ metered?: boolean }>("network"))?.metered);

export type AndroidSelfTest = { rtf: number; threads: number; loadMs: number; seconds: number; mode: "live" | "prepare" | "off" };

/**
 * After the pack is installed: one sentence made and timed on this phone, and
 * the result kept with the pack (`studio_voice_record_self_test`, which the
 * pack's status then gives back as `selfTest` and `slow`).
 */
export const androidStudioSelfTest = async (voice?: string): Promise<AndroidSelfTest | null> => {
  const result = await android.readAloud<AndroidSelfTest>("studioSelfTest", voice ? { voice } : {});
  if (!result || !Number.isFinite(result.rtf)) return null;
  await invoke("studio_voice_record_self_test", { rtf: result.rtf, threads: result.threads });
  return result;
};
