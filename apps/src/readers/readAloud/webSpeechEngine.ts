/**
 * Reading aloud with the browser's own speech (the Web Speech API): on
 * Windows, WebView2 speaks with the voices Windows has installed, and goes
 * on while the window is in the background.
 *
 * Pausing cancels the speech and resuming says the sentence again from its
 * start, as on Android: the browser's own pause is unreliable with some
 * voices (it never comes back from it).
 */
import { eventHub, type SpeechEngine, type SpeechItem, type SpeechVoice } from "./engine";

export const webSpeechAvailable = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

/** How long to wait for the voices to arrive (Chromium lists them a moment after the first ask). */
const VOICES_WAIT_MS = 1500;

export const webSpeechEngine = (synth: SpeechSynthesis = window.speechSynthesis): SpeechEngine => {
  const hub = eventHub();
  let items: SpeechItem[] = [];
  let at = 0;
  let playing = false;
  let rate = 1;
  let voice: SpeechSynthesisVoice | null = null;
  let lang: string | null = null;
  /** Bumped at every cancel: what the browser says afterwards of older utterances is not listened to. */
  let generation = 0;

  const queue = (index: number) => {
    const item = items[index];
    if (!item) return;
    const mine = generation;
    const utterance = new window.SpeechSynthesisUtterance(item.text);
    utterance.rate = rate;
    if (voice) utterance.voice = voice;
    if (voice?.lang ?? lang) utterance.lang = voice?.lang ?? lang ?? "";
    utterance.onstart = () => {
      if (mine !== generation) return;
      at = index;
      hub.emit({ type: "start", id: item.id });
    };
    utterance.onend = () => {
      if (mine !== generation) return;
      hub.emit({ type: "done", id: item.id });
    };
    utterance.onerror = (event) => {
      if (mine !== generation || event.error === "interrupted" || event.error === "canceled") return;
      hub.emit({ type: "error", id: item.id, message: event.error });
    };
    synth.speak(utterance);
  };

  const speakFrom = (index: number) => {
    generation += 1;
    synth.cancel();
    for (let next = index; next < items.length; next += 1) {
      queue(next);
    }
  };

  const findVoice = (id: string | null) => (id ? (synth.getVoices().find((entry) => entry.voiceURI === id) ?? null) : null);

  return {
    kind: "web",
    async voices(): Promise<SpeechVoice[]> {
      let found = synth.getVoices();
      if (found.length === 0) {
        found = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
          const done = () => {
            synth.removeEventListener?.("voiceschanged", done);
            resolve(synth.getVoices());
          };
          synth.addEventListener?.("voiceschanged", done);
          setTimeout(done, VOICES_WAIT_MS);
        });
      }
      return found.map((entry) => ({
        id: entry.voiceURI,
        name: entry.name,
        lang: entry.lang.replace("_", "-"),
        online: !entry.localService,
        preferred: entry.default
      }));
    },
    speak(next, { replace }) {
      if (replace) {
        items = [...next];
        at = 0;
        playing = true;
        speakFrom(0);
        return;
      }
      const from = items.length;
      items.push(...next);
      if (playing) {
        for (let index = from; index < items.length; index += 1) queue(index);
      }
    },
    pause() {
      playing = false;
      generation += 1;
      synth.cancel();
    },
    resume() {
      if (playing || items.length === 0) return;
      playing = true;
      speakFrom(at);
    },
    stop() {
      playing = false;
      generation += 1;
      items = [];
      at = 0;
      synth.cancel();
    },
    setRate(next) {
      rate = next;
    },
    setVoice(id, language) {
      voice = findVoice(id);
      lang = language;
    },
    onEvent: hub.on
  };
};
