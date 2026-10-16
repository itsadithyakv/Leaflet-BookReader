/**
 * Reading aloud, from a place to the end of the book: which sentences go to
 * the voice and when. Only a few at a time go ahead of the one being spoken
 * (`ahead`; more while Leaflet is out of sight, when the page may be slow to
 * answer), topped up as each one starts, and the next chapter follows on its
 * own. Moving a sentence back or on, or a new speed or voice, starts the
 * queue again from that sentence.
 *
 * The text comes from a source (`SentenceSource`): the hook reads each
 * chapter from the book's file, so reading on never waits for the page to
 * draw the next chapter (it may not draw at all with the screen off).
 */
import { sentenceAt, type Sentence } from "./chapterText";
import type { EngineEvent, SpeechEngine, SpeechItem } from "./engine";

export type SentenceSource = {
  /** A chapter's sentences: empty for one with nothing to read, null for one that is not there. */
  load(section: number): Promise<Sentence[] | null>;
  /** The chapter read after this one, or null at the end of the book. */
  after(section: number): number | null;
  /** The chapter before, or null at the start. */
  before(section: number): number | null;
};

export type PlayerStatus = "idle" | "loading" | "playing" | "paused";

export type PlayerState = {
  status: PlayerStatus;
  /** The sentence being read (or paused in). */
  current: Sentence | null;
};

export type PlayerOptions = {
  /** How many sentences to keep queued past the one being spoken. */
  ahead?: () => number;
  onChange?: (state: PlayerState) => void;
  /** The book has been read to its end. */
  onEnd?: () => void;
  /** Stopped from outside the page (Android's notification). */
  onStopped?: () => void;
  /** Chapters kept in memory. */
  keep?: number;
};

export const DEFAULT_AHEAD = 6;

export const sentenceId = (sentence: Pick<Sentence, "section" | "n">) => `${sentence.section}:${sentence.n}`;

const toItem = (sentence: Sentence): SpeechItem => ({ id: sentenceId(sentence), text: sentence.text });

export const createPlayer = (engine: SpeechEngine, source: SentenceSource, options: PlayerOptions = {}) => {
  const ahead = options.ahead ?? (() => DEFAULT_AHEAD);
  const keep = Math.max(2, options.keep ?? 4);
  const chapters = new Map<number, Sentence[] | null>();
  let state: PlayerState = { status: "idle", current: null };
  /** What the engine has been given since the queue last started again, in order. */
  let sent: Sentence[] = [];
  /** No more after the last one sent: the book ends there. */
  let exhausted = false;
  /** Bumped whenever the queue starts again: work begun before then is dropped. */
  let generation = 0;
  let topping = false;
  /** Paused after a move or a change of voice: the queue starts again on resume. */
  let restartOnResume = false;

  const set = (next: Partial<PlayerState>) => {
    state = { ...state, ...next };
    options.onChange?.(state);
  };

  const chapter = async (section: number): Promise<Sentence[] | null> => {
    if (chapters.has(section)) {
      const kept = chapters.get(section) ?? null;
      // Most recently used last.
      chapters.delete(section);
      chapters.set(section, kept);
      return kept;
    }
    const loaded = await source.load(section);
    chapters.set(section, loaded);
    while (chapters.size > keep) {
      const oldest = chapters.keys().next().value as number;
      chapters.delete(oldest);
    }
    return loaded;
  };

  /** The first sentence of this chapter or the next one with any, or null past the end of the book. */
  const firstFrom = async (section: number | null): Promise<Sentence | null> => {
    let at = section;
    // (A book has an end: a chapter list that loops is cut off.)
    for (let guard = 0; at !== null && guard < 10000; guard += 1) {
      const sentences = await chapter(at);
      if (sentences && sentences.length > 0) {
        return sentences[0];
      }
      at = source.after(at);
    }
    return null;
  };

  const lastBefore = async (section: number | null): Promise<Sentence | null> => {
    let at = section;
    for (let guard = 0; at !== null && guard < 10000; guard += 1) {
      const sentences = await chapter(at);
      if (sentences && sentences.length > 0) {
        return sentences[sentences.length - 1];
      }
      at = source.before(at);
    }
    return null;
  };

  const following = async (sentence: Sentence): Promise<Sentence | null> => {
    const sentences = await chapter(sentence.section);
    if (sentences && sentence.n + 1 < sentences.length) {
      return sentences[sentence.n + 1];
    }
    return firstFrom(source.after(sentence.section));
  };

  const preceding = async (sentence: Sentence): Promise<Sentence | null> => {
    const sentences = await chapter(sentence.section);
    if (sentences && sentence.n > 0 && sentences[sentence.n - 1]) {
      return sentences[sentence.n - 1];
    }
    return lastBefore(source.before(sentence.section));
  };

  const indexOfCurrent = () => (state.current ? sent.findIndex((item) => item.section === state.current?.section && item.n === state.current?.n) : -1);

  /** Keeps `ahead()` sentences queued past the current one. */
  const topUp = async () => {
    if (topping || exhausted || sent.length === 0) {
      return;
    }
    topping = true;
    const mine = generation;
    try {
      const batch: Sentence[] = [];
      let last = sent[sent.length - 1];
      const want = () => Math.max(1, ahead()) - (sent.length + batch.length - 1 - Math.max(0, indexOfCurrent()));
      while (want() > 0) {
        const next = await following(last);
        if (mine !== generation) {
          return;
        }
        if (!next) {
          exhausted = true;
          break;
        }
        batch.push(next);
        last = next;
      }
      if (batch.length > 0 && mine === generation) {
        sent.push(...batch);
        engine.speak(batch.map(toItem), { replace: false });
      }
    } finally {
      if (mine === generation) {
        topping = false;
      }
    }
  };

  /** Starts the queue again at this sentence, speaking at once. */
  const playFrom = (sentence: Sentence) => {
    generation += 1;
    topping = false;
    exhausted = false;
    restartOnResume = false;
    sent = [sentence];
    set({ status: "playing", current: sentence });
    engine.speak([toItem(sentence)], { replace: true });
    void topUp();
  };

  const finish = () => {
    generation += 1;
    sent = [];
    set({ status: "idle", current: null });
    engine.stop();
    options.onEnd?.();
  };

  const find = (id: string) => sent.find((item) => sentenceId(item) === id) ?? null;

  const onEvent = (event: EngineEvent) => {
    switch (event.type) {
      case "start": {
        const sentence = find(event.id);
        if (!sentence) return;
        set({ status: "playing", current: sentence });
        void topUp();
        return;
      }
      case "at": {
        const sentence = find(event.id);
        if (sentence) set({ current: sentence });
        return;
      }
      case "done":
      case "error": {
        if (state.status !== "playing") return;
        const id = event.id;
        const last = sent[sent.length - 1];
        if (id !== null && last && sentenceId(last) === id) {
          if (exhausted) {
            finish();
          } else {
            // The queue ran dry before it was topped up: carry on from the next.
            const mine = generation;
            void following(last).then((next) => {
              if (mine !== generation) return;
              if (next) playFrom(next);
              else finish();
            });
          }
        }
        return;
      }
      case "state":
        if (state.status === "idle") return;
        set({ status: event.playing ? "playing" : "paused" });
        return;
      case "stopped":
        if (state.status === "idle") return;
        generation += 1;
        sent = [];
        set({ status: "idle", current: null });
        options.onStopped?.();
        return;
    }
  };
  const unsubscribe = engine.onEvent(onEvent);

  /** Moves a sentence on or back: spoken at once while playing, kept for resume while paused. */
  const moveTo = (sentence: Sentence) => {
    if (state.status === "paused") {
      generation += 1;
      sent = [sentence];
      restartOnResume = true;
      set({ current: sentence });
      return;
    }
    playFrom(sentence);
  };

  let moves: Promise<void> = Promise.resolve();
  const queueMove = (move: () => Promise<void>) => {
    moves = moves.then(move, move);
    return moves;
  };

  return {
    get state() {
      return state;
    },
    /** Reads from the sentence at this offset of a chapter's text (or the first one after it). */
    async start(section: number, offset = 0) {
      generation += 1;
      const mine = generation;
      engine.stop();
      sent = [];
      set({ status: "loading", current: null });
      const sentences = await chapter(section);
      if (mine !== generation) return;
      const index = sentences && sentences.length > 0 ? sentenceAt(sentences, offset) : -1;
      const sentence = sentences && index >= 0 && sentences[index].end > offset ? sentences[index] : await firstFrom(source.after(section));
      if (mine !== generation) return;
      if (!sentence) {
        set({ status: "idle", current: null });
        options.onEnd?.();
        return;
      }
      playFrom(sentence);
    },
    pause() {
      if (state.status !== "playing") return;
      engine.pause();
      set({ status: "paused" });
    },
    resume() {
      if (state.status !== "paused" || !state.current) return;
      if (restartOnResume) {
        playFrom(state.current);
        return;
      }
      engine.resume();
      set({ status: "playing" });
    },
    /** A sentence on. Presses in quick succession each count (they are made one after another). */
    next() {
      return queueMove(async () => {
        const current = state.current;
        if (!current || state.status === "idle" || state.status === "loading") return;
        const mine = generation;
        const target = await following(current);
        if (mine !== generation) return;
        if (target) moveTo(target);
        else finish();
      });
    },
    previous() {
      return queueMove(async () => {
        const current = state.current;
        if (!current || state.status === "idle" || state.status === "loading") return;
        const mine = generation;
        const target = (await preceding(current)) ?? current;
        if (mine !== generation) return;
        moveTo(target);
      });
    },
    /** A new speed: heard from the start of the sentence being read. */
    setRate(rate: number) {
      engine.setRate(rate);
      if (state.status === "playing" && state.current) {
        playFrom(state.current);
      } else if (state.status === "paused") {
        restartOnResume = true;
      }
    },
    setVoice(id: string | null, lang: string | null) {
      engine.setVoice(id, lang);
      if (state.status === "playing" && state.current) {
        playFrom(state.current);
      } else if (state.status === "paused") {
        restartOnResume = true;
      }
    },
    /** More is wanted queued now (Leaflet is going out of sight). */
    topUp() {
      void topUp();
    },
    stop() {
      generation += 1;
      sent = [];
      restartOnResume = false;
      engine.stop();
      set({ status: "idle", current: null });
    },
    dispose() {
      generation += 1;
      unsubscribe();
    }
  };
};

export type ReadAloudPlayer = ReturnType<typeof createPlayer>;
