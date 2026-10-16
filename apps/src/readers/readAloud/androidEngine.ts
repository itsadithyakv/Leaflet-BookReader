/**
 * Reading aloud on Android: the phone's own text-to-speech, in Kotlin
 * (`ReadAloud.kt`), which keeps the queue, plays on with the screen off
 * (a media-playback service with its notification and lock-screen
 * controls), and pauses for a call, other audio or unplugged headphones.
 * What happens there comes back through `window.__leafletReadAloud`, which
 * the Kotlin side calls as `__leafletBack` is called.
 */
import { android, onAndroid } from "../../platform/android";
import { eventHub, type EngineEvent, type SpeechEngine, type SpeechVoice } from "./engine";

declare global {
  interface Window {
    /** Called by the Android side as the voice reads (ReadAloud.kt). */
    __leafletReadAloud?: (event: EngineEvent) => void;
  }
}

export const androidSpeechAvailable = () => onAndroid();

/** Opens Android's text-to-speech settings (where a voice is added). */
export const openSpeechSettings = () => void android.readAloud("settings");

export const androidEngine = (): SpeechEngine => {
  const hub = eventHub();
  window.__leafletReadAloud = (event) => hub.emit(event);
  const send = (op: string, args?: Record<string, unknown>) => void android.readAloud(op, args);
  return {
    kind: "android",
    async voices(): Promise<SpeechVoice[]> {
      const answer = await android.readAloud<{ voices?: SpeechVoice[] }>("voices");
      return Array.isArray(answer?.voices) ? answer.voices : [];
    },
    speak(items, { replace }) {
      send("speak", { items, replace });
    },
    pause: () => send("pause"),
    resume: () => send("resume"),
    stop: () => send("stop"),
    setRate: (rate) => send("rate", { rate }),
    setVoice: (id, lang) => send("voice", { voice: id, language: lang }),
    setInfo: (info) => send("info", info),
    onEvent: hub.on
  };
};
