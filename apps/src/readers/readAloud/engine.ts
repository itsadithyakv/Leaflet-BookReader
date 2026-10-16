/**
 * The voice that reads aloud, behind one interface: Android's own
 * text-to-speech (through the device plugin, `androidEngine.ts`), the
 * browser's speech synthesis on Windows (`webSpeechEngine.ts`), or a fake
 * for tests and for the browser preview, which may have no voices at all.
 *
 * The engine holds a queue of sentences (`speak`) and says when each one
 * starts and is done; the player (`player.ts`) decides what goes in it, a
 * few sentences at a time. Pausing, resuming and the speed are the engine's,
 * so that Android's notification can work them while the page is asleep.
 */

export type SpeechItem = { id: string; text: string };

export type SpeechVoice = {
  id: string;
  name: string;
  /** BCP 47, as the engine gives it ("en-US", "en_US" made "en-US"). */
  lang: string;
  /** Needs the network to speak. */
  online?: boolean;
  /** The engine's own pick for its language. */
  preferred?: boolean;
};

export type EngineEvent =
  /** A sentence has started. */
  | { type: "start"; id: string }
  /** A sentence has been spoken to its end. */
  | { type: "done"; id: string }
  /** The engine moved to a sentence without speaking it (skipped while paused, from the notification). */
  | { type: "at"; id: string }
  /** A sentence could not be spoken; the engine has gone on to the next. */
  | { type: "error"; id: string | null; message?: string }
  /** Paused or resumed from outside the page: the notification, a call, headphones pulled out. */
  | { type: "state"; playing: boolean }
  /** Stopped from outside the page (the notification's stop). */
  | { type: "stopped" };

export type EngineKind = "android" | "web" | "fake";

export interface SpeechEngine {
  readonly kind: EngineKind;
  /** The voices there are, for every language. Empty when the device has no speech at all. */
  voices(): Promise<SpeechVoice[]>;
  /** Queue sentences: after what is queued, or (`replace`) instead of it, starting at once. */
  speak(items: SpeechItem[], options: { replace: boolean }): void;
  pause(): void;
  /** Goes on from the start of the sentence that was paused in. */
  resume(): void;
  /** Empties the queue and lets the voice (and on Android, its notification) go. */
  stop(): void;
  /** 1 is the voice's own pace. Takes effect from the next sentence. */
  setRate(rate: number): void;
  /** Null: the engine's own voice for the language. */
  setVoice(id: string | null, lang: string | null): void;
  /** What the notification and the lock screen say is being read (Android). */
  setInfo?(info: { title: string; author: string; chapter: string }): void;
  onEvent(listener: (event: EngineEvent) => void): () => void;
}

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

/**
 * An engine that speaks nothing: it says each sentence started at once and
 * is done when `advance()` is called (or after `autoMs`, when set). For tests,
 * and the browser preview, where there may be no voices.
 */
export const fakeEngine = (options: { voices?: SpeechVoice[]; autoMs?: number } = {}) => {
  const hub = eventHub();
  let queue: SpeechItem[] = [];
  let at = -1;
  let playing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const log: string[] = [];
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (options.autoMs !== undefined && playing && at >= 0 && at < queue.length) {
      timer = setTimeout(() => engine.advance(), options.autoMs);
    }
  };
  const begin = () => {
    if (!playing || at < 0 || at >= queue.length) return;
    hub.emit({ type: "start", id: queue[at].id });
    schedule();
  };
  const engine = {
    kind: "fake" as const,
    rate: 1,
    voice: null as string | null,
    log,
    get queue() {
      return queue.map((item) => item.id);
    },
    get current() {
      return at >= 0 && at < queue.length ? queue[at].id : null;
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
        queue = [...items];
        at = items.length > 0 ? 0 : -1;
        playing = items.length > 0;
        begin();
        return;
      }
      const wasDrained = at >= queue.length || at < 0;
      queue.push(...items);
      if (wasDrained && playing && items.length > 0) {
        at = queue.length - items.length;
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
      playing = false;
    },
    setRate(rate: number) {
      engine.rate = rate;
    },
    setVoice(id: string | null) {
      engine.voice = id;
    },
    onEvent: hub.on,
    /** The sentence being spoken is done: the next starts. */
    advance() {
      if (!playing || at < 0 || at >= queue.length) return;
      const id = queue[at].id;
      at += 1;
      hub.emit({ type: "done", id });
      begin();
    },
    /** As if from the notification or the system. */
    emit: hub.emit
  };
  return engine satisfies SpeechEngine;
};

export type FakeEngine = ReturnType<typeof fakeEngine>;
