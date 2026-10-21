/**
 * The voice that reads aloud, behind one interface: Android's own
 * text-to-speech (through the device plugin, `androidEngine.ts`), the
 * browser's speech synthesis on Windows (`webSpeechEngine.ts`), or a fake
 * for tests and for the browser preview, which may have no voices at all.
 * Another engine (a voice of Leaflet's own, run on the device: "neural")
 * goes behind the same interface: it is given items of text and says when
 * each starts, which word it is at, and when each is done.
 *
 * The engine holds a queue of items (`speak`), each a paragraph or a
 * sentence (`units.ts`) with the silence to keep before it; the player
 * (`player.ts`) decides what goes in it, a few at a time. Pausing, resuming
 * and the speed are the engine's, so that Android's notification can work
 * them while the page is asleep.
 */

export type SpeechItem = {
  id: string;
  text: string;
  /** Silence before it, in ms (none when it is resumed part of the way in). */
  silence?: number;
  /**
   * Where each sentence of it starts in `text` (the first at 0). An engine
   * that knows how long each sentence takes to say (a neural voice, which
   * makes the sound itself) says it is at each one with a `boundary` of kind
   * "sentence" at these offsets.
   */
  marks?: number[];
  /**
   * Each sentence's phonemes (one per mark), from Leaflet's own English G2P,
   * for a neural voice that speaks from phonemes rather than text (sherpa-onnx
   * 2.0). Unset: it reads the text.
   */
  phonemes?: (string | null)[];
};

export type SpeechVoice = {
  id: string;
  name: string;
  /** BCP 47, as the engine gives it ("en-US", "en_US" made "en-US"). */
  lang: string;
  /** Needs the network to speak. */
  online?: boolean;
  /** The engine's own pick for its language. */
  preferred?: boolean;
  /** How good it sounds, on Android's scale: 100 very low, 300 normal, 400 high, 500 very high (a natural voice). */
  quality?: number;
  /** How long it takes to start, on Android's scale: 100 very low to 500 very high. */
  latency?: number;
  /** Android's stand-in for a language rather than a voice of its own (`legacySetLanguageVoice`). */
  legacy?: boolean;
  /** False: listed, but its data is not on the device yet. */
  installed?: boolean;
  /** One of Leaflet's own downloaded voices (a "studio" voice, "neural:af_heart"), listed above the device's. */
  studio?: boolean;
  /** A studio voice this device makes slower than it speaks: it prepares a chapter before it starts, and is never picked by itself. */
  slow?: boolean;
  /** A studio voice not yet tried here (no self-test has passed): listed, never picked by itself. */
  untested?: boolean;
};

export type EngineEvent =
  /** An item has started (`from`: where in its text, when it is resumed part of the way in). */
  | { type: "start"; id: string; from?: number }
  /** The voice is at this offset of the item's text: a word starting (or a sentence, where the engine says so). */
  | { type: "boundary"; id: string; charIndex: number; charLength?: number; kind?: "word" | "sentence" }
  /** An item has been spoken to its end. */
  | { type: "done"; id: string }
  /** The engine moved to an item without speaking it (skipped while paused, from the notification). */
  | { type: "at"; id: string }
  /** An item could not be spoken; the engine has gone on to the next. */
  | { type: "error"; id: string | null; message?: string }
  /** Paused or resumed from outside the page: the notification, a call, headphones pulled out. */
  | { type: "state"; playing: boolean }
  /** Stopped from outside the page (the notification's stop). */
  | { type: "stopped" }
  /** A neural voice preparing the chapter before it starts: about `seconds` to go; null, it has started (or stopped waiting). */
  | { type: "preparing"; seconds: number | null };

export type EngineKind = "android" | "web" | "neural" | "fake";

export interface SpeechEngine {
  readonly kind: EngineKind;
  /**
   * What the engine promises to say of where it is in an item: every word
   * ("word"), or every sentence at the item's `marks` ("sentence"). Unset:
   * as the voice does, which the player finds out by listening (and gives a
   * sentence at a time until it has heard).
   */
  readonly progress?: "word" | "sentence";
  /** The voices there are, for every language. Empty when the device has no speech at all. */
  voices(): Promise<SpeechVoice[]>;
  /** Queue items: after what is queued, or (`replace`) instead of it, starting at once. */
  speak(items: SpeechItem[], options: { replace: boolean }): void;
  pause(): void;
  /** Goes on from the word it was paused at, where the engine knows it; else from the start of the item. */
  resume(): void;
  /** Empties the queue and lets the voice (and on Android, its notification) go. */
  stop(): void;
  /** 1 is the voice's own pace (the pitch stays the voice's own). Takes effect from the next item. */
  setRate(rate: number): void;
  /** Null: the engine's own voice for the language. */
  setVoice(id: string | null, lang: string | null): void;
  /** What the notification and the lock screen say is being read (Android). */
  setInfo?(info: { title: string; author: string; chapter: string; bookId?: string }): void;
  /** Sentences wanted queued ahead now (more for a voice that prepares a chapter first); unset or null: the usual. */
  ahead?(): number | null;
  /** Makes these ahead, quietly, before reading starts (a voice that prepares first, on a slow device). */
  prepare?(items: SpeechItem[], options: { bookId?: string }): void;
  /** The book closed: anything made ahead for it goes. */
  forget?(): void;
  onEvent(listener: (event: EngineEvent) => void): () => void;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * News from a voice made outside the page (Android's Kotlin, the Studio
 * voice's Rust) as an `EngineEvent`; anything malformed or unknown is dropped.
 * Both send "preparing" as `{ type: "preparing", seconds }` (seconds null: no
 * longer waiting), Rust with the `id` it waits to start as well.
 */
export const toEngineEvent = (raw: unknown): EngineEvent | null => {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  switch (event.type) {
    case "start":
      if (!isString(event.id)) return null;
      return isCount(event.from) && event.from > 0 ? { type: "start", id: event.id, from: event.from } : { type: "start", id: event.id };
    case "boundary": {
      if (!isString(event.id) || !isCount(event.charIndex)) return null;
      const kind = event.kind === "sentence" ? "sentence" : "word";
      return {
        type: "boundary",
        id: event.id,
        charIndex: event.charIndex,
        kind,
        ...(kind === "word" && isCount(event.charLength) ? { charLength: event.charLength } : {})
      };
    }
    case "done":
    case "at":
      return isString(event.id) ? { type: event.type, id: event.id } : null;
    case "error":
      return { type: "error", id: isString(event.id) ? event.id : null, ...(isString(event.message) ? { message: event.message } : {}) };
    case "state":
      return typeof event.playing === "boolean" ? { type: "state", playing: event.playing } : null;
    case "stopped":
      return { type: "stopped" };
    case "preparing":
      return { type: "preparing", seconds: isCount(event.seconds) ? Math.round(event.seconds) : null };
    default:
      return null;
  }
};

/** Listeners, for an engine's own use. */
export const eventHub = () => {
  const listeners = new Set<(event: EngineEvent) => void>();
  return {
    on(listener: (event: EngineEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event: EngineEvent) {
      [...listeners].forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          console.warn("read aloud:", error);
        }
      });
    }
  };
};

/** Where each word of a text starts. */
const wordStarts = (text: string) => [...text.matchAll(/[^\s]+/gu)].map((match) => ({ at: match.index ?? 0, length: match[0].length }));

/**
 * An engine that speaks nothing: it says each item started at once and is
 * done when `advance()` is called (or after `autoMs`, when set; with
 * `wordMs`, a word at a time, saying where it is as it goes). `word(n)` says
 * the voice is at the n-th word of the item. For tests, and the browser
 * preview, where there may be no voices.
 */
export const fakeEngine = (options: { voices?: SpeechVoice[]; autoMs?: number; wordMs?: number; kind?: EngineKind } = {}) => {
  const hub = eventHub();
  let queue: SpeechItem[] = [];
  let at = -1;
  let playing = false;
  /** Where the voice is in the item it is on (resume goes on from there). */
  let heard = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const log: string[] = [];
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (!playing || at < 0 || at >= queue.length) return;
    if (options.wordMs !== undefined) {
      const words = wordStarts(queue[at].text);
      const next = words.findIndex((word) => word.at > heard);
      timer = setTimeout(() => (next < 0 ? engine.advance() : engine.word(next)), options.wordMs);
      return;
    }
    if (options.autoMs !== undefined) {
      timer = setTimeout(() => engine.advance(), options.autoMs);
    }
  };
  const begin = () => {
    if (!playing || at < 0 || at >= queue.length) return;
    const item = queue[at];
    log.push(`say:${item.id}${item.silence ? `~${item.silence}` : ""}${heard > 0 ? `@${heard}` : ""}`);
    hub.emit({ type: "start", id: item.id, ...(heard > 0 ? { from: heard } : {}) });
    if (options.wordMs !== undefined) {
      const words = wordStarts(item.text);
      const first = words.find((word) => word.at >= heard);
      if (first) {
        heard = first.at;
        hub.emit({ type: "boundary", id: item.id, charIndex: first.at, charLength: first.length, kind: "word" });
      }
    }
    schedule();
  };
  const engine = {
    kind: (options.kind ?? "fake") as EngineKind,
    rate: 1,
    voice: null as string | null,
    log,
    get queue() {
      return queue.map((item) => item.id);
    },
    get items() {
      return [...queue];
    },
    get current() {
      return at >= 0 && at < queue.length ? queue[at].id : null;
    },
    get currentItem() {
      return at >= 0 && at < queue.length ? queue[at] : null;
    },
    get playing() {
      return playing;
    },
    async voices() {
      return options.voices ?? [{ id: "fake-en", name: "Test voice", lang: "en-US", preferred: true }];
    },
    speak(items: SpeechItem[], { replace }: { replace: boolean }) {
      log.push(`${replace ? "replace" : "add"}:${items.map((item) => item.id).join(",")}`);
      if (replace) {
        clear();
        queue = [...items];
        at = items.length > 0 ? 0 : -1;
        heard = 0;
        playing = items.length > 0;
        begin();
        return;
      }
      const wasDrained = at >= queue.length || at < 0;
      queue.push(...items);
      if (wasDrained && playing && items.length > 0) {
        at = queue.length - items.length;
        heard = 0;
        begin();
      }
    },
    pause() {
      log.push("pause");
      playing = false;
      clear();
    },
    resume() {
      log.push("resume");
      if (playing) return;
      playing = true;
      begin();
    },
    stop() {
      log.push("stop");
      clear();
      queue = [];
      at = -1;
      heard = 0;
      playing = false;
    },
    setRate(rate: number) {
      engine.rate = rate;
    },
    setVoice(id: string | null) {
      engine.voice = id;
    },
    onEvent: hub.on,
    /** The voice is at the n-th word of the item it is on. */
    word(n: number) {
      if (!playing || at < 0 || at >= queue.length) return;
      const item = queue[at];
      const word = wordStarts(item.text)[n];
      if (!word) return;
      heard = word.at;
      hub.emit({ type: "boundary", id: item.id, charIndex: word.at, charLength: word.length, kind: "word" });
      schedule();
    },
    /** The item being spoken is done: the next starts. */
    advance() {
      if (!playing || at < 0 || at >= queue.length) return;
      const id = queue[at].id;
      at += 1;
      heard = 0;
      hub.emit({ type: "done", id });
      begin();
    },
    /** As if from the notification or the system. */
    emit: hub.emit
  };
  return engine satisfies SpeechEngine;
};

export type FakeEngine = ReturnType<typeof fakeEngine>;
