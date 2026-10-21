/**
 * Reading aloud with the browser's own speech (the Web Speech API): on
 * Windows, WebView2 speaks with the voices Windows has installed, and goes
 * on while the window is in the background.
 *
 * The items are said one at a time, each after the silence it asks for (a
 * timer: Windows' speech reads markup out as words, so a pause cannot go in
 * the text). Out of sight, where timers are slowed, the rest of the queue
 * goes to the browser at once and the voice reads on without the pauses.
 *
 * The voice says which word it is at (`boundary`, Windows' voices do), so
 * pausing cancels the speech and resuming goes on from that word: the
 * browser's own pause is unreliable with some voices (it never comes back
 * from it).
 */
import { eventHub, type SpeechEngine, type SpeechItem, type SpeechVoice } from "./engine";
import { webVoiceQuality } from "./voiceRank";

export const webSpeechAvailable = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

/** How long to wait for the voices to arrive (Chromium lists them a moment after the first ask). */
const VOICES_WAIT_MS = 1500;

type Options = {
  /** Whether Leaflet is out of sight (timers slowed): the queue goes to the browser whole. */
  hidden?: () => boolean;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

export const webSpeechEngine = (synth: SpeechSynthesis = window.speechSynthesis, options: Options = {}): SpeechEngine => {
  const hub = eventHub();
  const hidden = options.hidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let items: SpeechItem[] = [];
  /** The item being said, or the next to be (between two, in the silence). */
  let at = 0;
  /** Where the voice is in that item: the start of the last word it said. */
  let heard = 0;
  /** The last item handed to the browser. */
  let handed = -1;
  /** Utterances handed and not yet ended (kept, too: Chromium drops the events of one let go). */
  const live = new Set<SpeechSynthesisUtterance>();
  let timer: unknown = null;
  let playing = false;
  let rate = 1;
  let voice: SpeechSynthesisVoice | null = null;
  let lang: string | null = null;
  /** Bumped at every cancel: what the browser says afterwards of older utterances is not listened to. */
  let generation = 0;

  const clear = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const say = (index: number, from: number) => {
    const item = items[index];
    if (!item) return;
    handed = Math.max(handed, index);
    const mine = generation;
    const start = Math.max(0, Math.min(from, item.text.length - 1));
    const utterance = new window.SpeechSynthesisUtterance(start > 0 ? item.text.slice(start) : item.text);
    utterance.rate = rate;
    if (voice) utterance.voice = voice;
    if (voice?.lang ?? lang) utterance.lang = voice?.lang ?? lang ?? "";
    live.add(utterance);
    const finish = () => {
      live.delete(utterance);
      if (mine !== generation) return false;
      if (at === index) {
        at = index + 1;
        heard = 0;
      }
      return true;
    };
    utterance.onstart = () => {
      if (mine !== generation) return;
      at = index;
      heard = start;
      hub.emit({ type: "start", id: item.id, ...(start > 0 ? { from: start } : {}) });
    };
    utterance.onboundary = (event) => {
      if (mine !== generation || at !== index) return;
      const charIndex = start + (event.charIndex ?? 0);
      const kind = event.name === "sentence" ? "sentence" : "word";
      // (Windows says a sentence starts just before its first word: a pause then goes on from the sentence.)
      heard = Math.max(heard, charIndex);
      hub.emit({ type: "boundary", id: item.id, charIndex, ...(event.charLength ? { charLength: event.charLength } : {}), kind });
    };
    utterance.onend = () => {
      if (!finish()) return;
      hub.emit({ type: "done", id: item.id });
      handOn();
    };
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") {
        live.delete(utterance);
        return;
      }
      if (!finish()) return;
      hub.emit({ type: "error", id: item.id, message: event.error });
      handOn();
    };
    synth.speak(utterance);
  };

  /** The next item to the browser: after its silence, once the one before is done; all of them at once while out of sight. */
  const handOn = () => {
    if (!playing || timer !== null) return;
    if (hidden()) {
      for (let next = handed + 1; next < items.length; next += 1) say(next, 0);
      return;
    }
    if (live.size > 0) return;
    const next = Math.max(at, handed + 1);
    const item = items[next];
    if (!item) return;
    const silence = Math.max(0, item.silence ?? 0);
    if (silence > 0) {
      const mine = generation;
      timer = setTimer(() => {
        timer = null;
        if (mine === generation && playing) say(next, 0);
      }, silence);
      // (Until the silence ends, the voice is "at" the next item: a pause now goes on from its start.)
      at = next;
      heard = 0;
    } else {
      say(next, 0);
    }
  };

  const cancel = () => {
    generation += 1;
    clear();
    live.clear();
    synth.cancel();
  };

  const speakFrom = (index: number, from: number) => {
    cancel();
    at = index;
    heard = from;
    handed = index - 1;
    if (from > 0) say(index, from);
    else handOn();
  };

  const onVisibility = () => {
    // Out of sight: the voice must not wait on a slowed timer.
    if (playing && hidden() && timer !== null) {
      clear();
      say(at, 0);
      handOn();
    } else if (playing && hidden()) {
      handOn();
    }
  };
  if (typeof document !== "undefined" && !options.hidden) {
    document.addEventListener("visibilitychange", onVisibility);
  }

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
        preferred: entry.default,
        quality: webVoiceQuality(entry.name, !entry.localService)
      }));
    },
    speak(next, { replace }) {
      if (replace) {
        items = [...next];
        playing = items.length > 0;
        speakFrom(0, 0);
        return;
      }
      items.push(...next);
      handOn();
    },
    pause() {
      if (!playing) return;
      playing = false;
      cancel();
    },
    resume() {
      if (playing || at >= items.length) return;
      playing = true;
      speakFrom(at, heard);
    },
    stop() {
      playing = false;
      cancel();
      items = [];
      at = 0;
      heard = 0;
      handed = -1;
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
