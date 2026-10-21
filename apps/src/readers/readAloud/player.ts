/**
 * Reading aloud, from a place to the end of the book: what goes to the voice
 * and when. The voice is given units (`units.ts`): a paragraph at a time
 * where it says which word it is at, so its tune carries across sentences,
 * else a sentence at a time. Only a few sentences' worth go ahead of the one
 * being spoken (`ahead`; more while Leaflet is out of sight, when the page
 * may be slow to answer), topped up as each starts, and the next chapter
 * follows on its own.
 *
 * The sentence being read (and the word, where the voice says) comes from
 * the voice's own news: a unit starting, and each word of it. Moving a
 * sentence back or on starts the queue again from that sentence; a new speed
 * or voice, from the word being read.
 *
 * The text comes from a source (`SentenceSource`): the hook reads each
 * chapter from the book's file, so reading on never waits for the page to
 * draw the next chapter (it may not draw at all with the screen off).
 */
import { sentenceAt, type Sentence } from "./chapterText";
import type { EngineEvent, SpeechEngine, SpeechItem } from "./engine";
import { buildUnit, chapterSpan, placeIn, tailOf, wordCount, type Unit, type UnitMode } from "./units";
import { wordEnd } from "./speechText";

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

/** A word being said, as offsets of its chapter's text. */
export type SpokenWord = { sentence: Sentence; start: number; end: number };

export type PlayerOptions = {
  /** How many sentences to keep queued past the one being spoken. */
  ahead?: () => number;
  onChange?: (state: PlayerState) => void;
  /** The word being said (null: none known, as a sentence starts). Not through `onChange`: it comes several times a second. */
  onWord?: (word: SpokenWord | null) => void;
  /** The book has been read to its end. */
  onEnd?: () => void;
  /** Stopped from outside the page (Android's notification). */
  onStopped?: () => void;
  /** Stopped because the voice could not say anything (`FAILURES_TO_STOP` items in a row failed: a voice that needs the network, offline). */
  onFailed?: (message: string | null) => void;
  /** Chapters kept in memory. */
  keep?: number;
};

export const DEFAULT_AHEAD = 6;

/**
 * Items failing one after another, with nothing said between them, that stop
 * the reading. Each failed item used to move the reading on to the next, so a
 * voice that cannot speak at all (one that needs the network, offline) ran
 * through the rest of the book in moments, the page following it to the end.
 */
export const FAILURES_TO_STOP = 3;

export const sentenceId = (sentence: Pick<Sentence, "section" | "n">) => `${sentence.section}:${sentence.n}`;

/**
 * Whether each voice says which word it is at, as it has been heard to (by
 * engine and voice, for as long as Leaflet runs). Until a voice has, it is
 * given a sentence at a time; once it has, a paragraph.
 */
const wordNews = new Map<string, boolean>();
/** Units said through without a word of news, by voice: two, and the voice is taken not to give any. */
const silentUnits = new Map<string, number>();

/** For tests: forget what has been heard of the voices. */
export const forgetVoices = () => {
  wordNews.clear();
  silentUnits.clear();
};

const toItem = (unit: Unit): SpeechItem => ({
  id: unit.id,
  text: unit.text,
  ...(unit.silence > 0 ? { silence: unit.silence } : {}),
  marks: unit.parts.map((part) => part.at)
});

export const createPlayer = (engine: SpeechEngine, source: SentenceSource, options: PlayerOptions = {}) => {
  const ahead = options.ahead ?? (() => DEFAULT_AHEAD);
  const keep = Math.max(2, options.keep ?? 4);
  const chapters = new Map<number, Sentence[] | null>();
  let state: PlayerState = { status: "idle", current: null };
  /** What the engine has been given since the queue last started again, in order. */
  let sent: Unit[] = [];
  /** The unit being said, and where in it the voice is (an offset of its text). */
  let speaking: { unit: Unit; charIndex: number } | null = null;
  /** Units the voice has said a word of. */
  const heardIn = new Set<string>();
  /** No more after the last one sent: the book ends there. */
  let exhausted = false;
  /** Bumped whenever the queue starts again: work begun before then is dropped. */
  let generation = 0;
  let topping = false;
  /** Paused after a move or a change of voice: the queue starts again on resume, from here. */
  let restartAt: { sentence: Sentence; offset: number } | null = null;
  let rate = 1;
  let voiceKey = `${engine.kind}:default`;
  /** Items failed since the voice last said a word or an item through. */
  let failures = 0;

  const mode = (): UnitMode => (engine.progress || wordNews.get(voiceKey) === true ? "paragraph" : "sentence");

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

  const unitIn = (sentences: Sentence[] | null, sentence: Sentence, from: number, first: boolean): Unit | null => {
    const list = sentences ?? [sentence];
    const index = list[sentence.n] === sentence ? sentence.n : list.findIndex((entry) => entry.n === sentence.n && entry.start === sentence.start);
    return buildUnit(index >= 0 ? list : [sentence], index >= 0 ? index : 0, { from, mode: mode(), rate, first });
  };

  /** The unit that starts at this sentence (at `from` in what it says). */
  const unitFrom = async (sentence: Sentence, from: number, first: boolean): Promise<Unit | null> =>
    unitIn(await chapter(sentence.section), sentence, from, first);

  /** How many sentences are queued past the one being said. */
  const queuedAhead = () => {
    const current = state.current;
    let count = 0;
    let past = current === null;
    for (const unit of sent) {
      for (const part of unit.parts) {
        if (past) count += 1;
        else if (part.sentence === current) past = true;
      }
    }
    return past ? count : sent.reduce((total, unit) => total + unit.parts.length, 0);
  };

  /** Keeps `ahead()` sentences queued past the current one. */
  const topUp = async () => {
    if (topping || exhausted || sent.length === 0) {
      return;
    }
    topping = true;
    const mine = generation;
    try {
      const batch: Unit[] = [];
      let last = sent[sent.length - 1];
      const want = () => Math.max(1, ahead()) - queuedAhead() - batch.reduce((total, unit) => total + unit.parts.length, 0);
      while (want() > 0) {
        const tail = tailOf(last);
        let next: Unit | null;
        if (tail.cutShort) {
          next = await unitFrom(tail.part.sentence, tail.part.to, false);
        } else {
          const sentence = await following(tail.part.sentence);
          next = sentence ? await unitFrom(sentence, 0, false) : null;
        }
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

  /** Starts the queue again at this sentence (at `offset` in what it says), speaking at once. */
  const playFrom = async (sentence: Sentence, offset = 0) => {
    generation += 1;
    const mine = generation;
    topping = false;
    exhausted = false;
    restartAt = null;
    speaking = null;
    heardIn.clear();
    set({ status: "playing", current: sentence });
    options.onWord?.(null);
    // (The chapter is almost always at hand: then the voice is told at once, not a moment later.)
    const unit = chapters.has(sentence.section) ? unitIn(chapters.get(sentence.section) ?? null, sentence, offset, true) : await unitFrom(sentence, offset, true);
    if (mine !== generation || !unit) return;
    sent = [unit];
    engine.speak([toItem(unit)], { replace: true });
    void topUp();
  };

  const finish = () => {
    generation += 1;
    sent = [];
    speaking = null;
    set({ status: "idle", current: null });
    options.onWord?.(null);
    engine.stop();
    options.onEnd?.();
  };

  const find = (id: string) => sent.find((unit) => unit.id === id) ?? null;

  /** Where the voice is now, as a sentence and an offset in what it says: where a new speed or voice goes on from. */
  const here = (): { sentence: Sentence; offset: number } | null => {
    if (restartAt) return restartAt;
    const current = state.current;
    if (!current) return null;
    if (speaking) {
      const place = placeIn(speaking.unit, speaking.charIndex);
      if (place.sentence === current) return place;
    }
    return { sentence: current, offset: 0 };
  };

  const onEvent = (event: EngineEvent) => {
    switch (event.type) {
      case "start": {
        const unit = find(event.id);
        if (!unit) return;
        const charIndex = Math.max(0, event.from ?? 0);
        speaking = { unit, charIndex };
        const place = placeIn(unit, charIndex);
        set({ status: "playing", current: place.sentence });
        options.onWord?.(null);
        void topUp();
        return;
      }
      case "boundary": {
        const unit = find(event.id);
        if (!unit || state.status === "idle") return;
        failures = 0;
        if (event.kind !== "sentence" || engine.progress === "sentence") {
          heardIn.add(unit.id);
          if (wordNews.get(voiceKey) !== true) wordNews.set(voiceKey, true);
          silentUnits.delete(voiceKey);
        }
        speaking = { unit, charIndex: event.charIndex };
        const place = placeIn(unit, event.charIndex);
        if (place.sentence !== state.current) {
          set({ current: place.sentence });
          void topUp();
        }
        if (event.kind !== "sentence" && options.onWord) {
          const say = place.sentence.say;
          const given = event.charLength && event.charLength > 0 ? event.charIndex + event.charLength : wordEnd(unit.text, event.charIndex);
          // (Not the punctuation after it, where the engine counts it in.)
          const length = wordEnd(unit.text.slice(0, given), event.charIndex) - event.charIndex;
          const end = Math.min(say.length, place.offset + Math.max(1, length));
          options.onWord({ sentence: place.sentence, ...chapterSpan(place.sentence, place.offset, end) });
        }
        return;
      }
      case "at": {
        const unit = find(event.id);
        if (!unit) return;
        speaking = { unit, charIndex: 0 };
        set({ current: unit.parts[0].sentence });
        options.onWord?.(null);
        return;
      }
      case "done":
      case "error": {
        if (state.status !== "playing") return;
        if (event.type === "done") {
          failures = 0;
        } else {
          failures += 1;
          if (failures >= FAILURES_TO_STOP) {
            // The voice says nothing at all: stopped here, not run on to the end of the book.
            failures = 0;
            generation += 1;
            sent = [];
            speaking = null;
            restartAt = null;
            engine.stop();
            set({ status: "idle", current: null });
            options.onWord?.(null);
            options.onFailed?.(event.message ?? null);
            return;
          }
        }
        const id = event.id;
        const unit = id !== null ? find(id) : null;
        if (unit && event.type === "done" && !heardIn.has(unit.id) && wordCount(unit.text) >= 4) {
          // Said through without a word of where it was: this voice gives no news (another unit says so too).
          const count = (silentUnits.get(voiceKey) ?? 0) + 1;
          silentUnits.set(voiceKey, count);
          if (count >= 2) wordNews.set(voiceKey, false);
        }
        const last = sent[sent.length - 1];
        if (id !== null && last && last.id === id) {
          if (exhausted) {
            finish();
          } else {
            // The queue ran dry before it was topped up: carry on from the next.
            const mine = generation;
            const tail = tailOf(last);
            const next = tail.cutShort ? Promise.resolve(tail.part.sentence) : following(tail.part.sentence);
            void next.then((sentence) => {
              if (mine !== generation) return;
              if (!sentence) finish();
              else void playFrom(sentence, tail.cutShort && sentence === tail.part.sentence ? tail.part.to : 0);
            });
          }
        }
        return;
      }
      case "state":
        if (state.status === "idle") return;
        if (event.playing && restartAt) {
          // Carried on from the notification after a move here: from the place moved to.
          void playFrom(restartAt.sentence, restartAt.offset);
          return;
        }
        set({ status: event.playing ? "playing" : "paused" });
        return;
      case "stopped":
        if (state.status === "idle") return;
        generation += 1;
        sent = [];
        speaking = null;
        set({ status: "idle", current: null });
        options.onWord?.(null);
        options.onStopped?.();
        return;
    }
  };
  const unsubscribe = engine.onEvent(onEvent);

  /** Moves a sentence on or back: spoken at once while playing, kept for resume while paused. */
  const moveTo = (sentence: Sentence) => {
    if (state.status === "paused") {
      generation += 1;
      sent = [];
      speaking = null;
      restartAt = { sentence, offset: 0 };
      set({ current: sentence });
      options.onWord?.(null);
      return;
    }
    void playFrom(sentence);
  };

  let moves: Promise<void> = Promise.resolve();
  const queueMove = (move: () => Promise<void>) => {
    moves = moves.then(move, move);
    return moves;
  };

  /** A new speed or voice: heard from the word being read. */
  const restartHere = () => {
    const place = here();
    if (state.status === "playing" && place) {
      void playFrom(place.sentence, place.offset);
    } else if (state.status === "paused" && place) {
      generation += 1;
      sent = [];
      speaking = null;
      restartAt = place;
    }
  };

  return {
    get state() {
      return state;
    },
    /** Whether the voice is given paragraphs (it says where it is) or sentences. */
    get mode() {
      return mode();
    },
    /** Reads from the sentence at this offset of a chapter's text (or the first one after it). */
    async start(section: number, offset = 0) {
      generation += 1;
      const mine = generation;
      failures = 0;
      engine.stop();
      sent = [];
      speaking = null;
      restartAt = null;
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
      await playFrom(sentence);
    },
    /**
     * What `start` would read from this place, `ahead()` sentences of it,
     * handed to the engine to make ahead without reading (a voice that
     * prepares the chapter first). Nothing while reading.
     */
    async prepare(section: number, offset = 0) {
      if (!engine.prepare || state.status !== "idle") return;
      const mine = generation;
      const sentences = await chapter(section);
      if (mine !== generation || state.status !== "idle") return;
      const index = sentences && sentences.length > 0 ? sentenceAt(sentences, offset) : -1;
      const sentence = sentences && index >= 0 && sentences[index].end > offset ? sentences[index] : await firstFrom(source.after(section));
      if (!sentence || mine !== generation) return;
      const want = Math.max(1, ahead());
      const units: Unit[] = [];
      let count = 0;
      let unit: Unit | null = await unitFrom(sentence, 0, true);
      while (unit && count < want) {
        units.push(unit);
        count += unit.parts.length;
        const tail = tailOf(unit);
        if (tail.cutShort) {
          unit = await unitFrom(tail.part.sentence, tail.part.to, false);
        } else {
          const next = await following(tail.part.sentence);
          unit = next ? await unitFrom(next, 0, false) : null;
        }
        if (mine !== generation || state.status !== "idle") return;
      }
      if (units.length > 0) engine.prepare(units.map(toItem), {});
    },
    pause() {
      if (state.status !== "playing") return;
      engine.pause();
      set({ status: "paused" });
    },
    resume() {
      if (state.status !== "paused" || !state.current) return;
      if (restartAt) {
        void playFrom(restartAt.sentence, restartAt.offset);
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
    setRate(next: number) {
      rate = next;
      engine.setRate(next);
      restartHere();
    },
    setVoice(id: string | null, lang: string | null) {
      voiceKey = `${engine.kind}:${id ?? "default"}`;
      failures = 0;
      engine.setVoice(id, lang);
      restartHere();
    },
    /** More is wanted queued now (Leaflet is going out of sight). */
    topUp() {
      void topUp();
    },
    stop() {
      generation += 1;
      sent = [];
      speaking = null;
      restartAt = null;
      engine.stop();
      set({ status: "idle", current: null });
      options.onWord?.(null);
    },
    dispose() {
      generation += 1;
      unsubscribe();
    }
  };
};

export type ReadAloudPlayer = ReturnType<typeof createPlayer>;
