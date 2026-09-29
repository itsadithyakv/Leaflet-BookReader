/**
 * Turning what the reader does (scrolling, turning pages, reading ahead of
 * Dotty) into pace samples for `paceModel`.
 *
 * A sample is words read over the time spent reading them. The words are easy;
 * the time is not. A reader who stops to think, answers the door, or scrolls
 * past a page without reading it must not be taken for a slow or a fast
 * reader, so every step is checked against the pace the model expects before
 * it is counted.
 */

export type WindowSample = { words: number; ms: number };

export type StepResult = {
  /** Enough reading gathered: learn from it. */
  sample: WindowSample | null;
  /** This step was a stop (thinking, or away) and was left out. */
  paused: boolean;
};

type WindowOptions = {
  /** A window is learned from once it holds this much reading... */
  minMs: number;
  minWords: number;
  /** ...and one step longer than this is a stop, whatever the model says. */
  maxStepMs: number;
};

/** A stop to think is any step this much longer than its words should take... */
const PAUSE_FACTOR = 3;
/** ...plus this, so a short page read unhurriedly is not a pause. */
const PAUSE_GRACE_MS = 20_000;
/** Steps that look like pauses but keep coming: the reader is just slow here. */
const STEADY_SLOW_STEPS = 3;
/** Faster than this many times the expected pace, over this many words, is skimming. */
const SKIM_FACTOR = 4;
const SKIM_MIN_WORDS = 150;

/**
 * Reading gathered step by step until there is enough to learn from. Steps
 * that were pauses are left out entirely, words and time alike, so they cannot
 * bend the pace either way.
 */
export class ReadingWindow {
  private words = 0;
  private ms = 0;
  private slowSteps = 0;

  constructor(private readonly options: WindowOptions) {}

  /** `words` read (negative when the reader went back) over `ms`. */
  step(words: number, ms: number, expectedWpm: number): StepResult {
    if (!(ms > 0)) {
      return { sample: null, paused: false };
    }
    if (ms > this.options.maxStepMs) {
      // A long stop: what came before it is still good reading.
      return { sample: this.flush(), paused: true };
    }
    if (words > 0) {
      const expectedMs = (words / Math.max(40, expectedWpm)) * 60000;
      const stepWpm = words / (ms / 60000);
      if (words >= SKIM_MIN_WORDS && stepWpm > expectedWpm * SKIM_FACTOR) {
        // Scrolled past without reading: neither learned nor held against the rest.
        return { sample: this.flush(), paused: false };
      }
      if (ms > expectedMs * PAUSE_FACTOR + PAUSE_GRACE_MS) {
        this.slowSteps += 1;
        if (this.slowSteps < STEADY_SLOW_STEPS) {
          return { sample: null, paused: true };
        }
      } else {
        this.slowSteps = 0;
      }
    }
    this.words += words;
    this.ms += ms;
    if (this.words < -this.options.minWords * 3) {
      // Far back: that is going somewhere else, not rereading.
      this.reset();
      return { sample: null, paused: false };
    }
    if (this.ms >= this.options.minMs && this.words >= this.options.minWords) {
      const sample = { words: this.words, ms: this.ms };
      this.reset();
      return { sample, paused: false };
    }
    return { sample: null, paused: false };
  }

  /** What has been gathered, if it is worth learning from; the window starts over. */
  flush(): WindowSample | null {
    const sample = this.words >= 60 && this.ms >= 20_000 ? { words: this.words, ms: this.ms } : null;
    this.reset();
    return sample;
  }

  reset() {
    this.words = 0;
    this.ms = 0;
    this.slowSteps = 0;
  }
}

/**
 * Free reading by scrolling. Each observation is the word at the reading line
 * once a scroll has settled; the words between two of them were read in the
 * time between. `section` tells chapters apart: indices restart in each.
 */
export class ScrollPaceTracker {
  private last: { index: number; at: number; section: unknown } | null = null;
  private readonly window = new ReadingWindow({ minMs: 75_000, minWords: 180, maxStepMs: 180_000 });

  observe(index: number, at: number, section: unknown, expectedWpm: number): StepResult {
    const last = this.last;
    this.last = { index, at, section };
    if (!last || last.section !== section) {
      return { sample: last ? this.window.flush() : null, paused: false };
    }
    // Going back over text counts as time spent, not words gained (see ReadingWindow).
    return this.window.step(index - last.index, at - last.at, expectedWpm);
  }

  /** The reader stopped reading this way (another mode, another app, closed the book). */
  stop(): WindowSample | null {
    this.last = null;
    return this.window.flush();
  }
}

/**
 * Turning pages. A page read is the words on it over the time it was shown,
 * counted only when the reader moves on to the very next page; going back, or
 * jumping, starts over.
 */
export class PagePaceTracker {
  private shown: { key: string; words: number | null; at: number } | null = null;
  private readonly window = new ReadingWindow({ minMs: 60_000, minWords: 150, maxStepMs: 240_000 });

  /** A page came up. `forward` when it is the page after the one before. */
  show(key: string, at: number, forward: boolean, expectedWpm: number): StepResult {
    const previous = this.shown;
    this.shown = { key, words: null, at };
    if (!previous || previous.key === key) {
      return { sample: null, paused: false };
    }
    if (!forward) {
      this.window.reset();
      return { sample: null, paused: false };
    }
    if (previous.words === null) {
      // A page that could not be counted (a picture, a title page): passed over.
      return { sample: null, paused: false };
    }
    return this.window.step(previous.words, at - previous.at, expectedWpm);
  }

  /** How many words the page on screen holds, once they have been counted. */
  count(key: string, words: number) {
    if (this.shown?.key === key) {
      this.shown.words = Math.max(0, words);
    }
  }

  stop(): WindowSample | null {
    this.shown = null;
    return this.window.flush();
  }
}

export type CatchUp =
  /** The reader is faster than Dotty, at about this pace. */
  | { kind: "faster"; wpm: number }
  /** The reader moved on without reading at a measurable pace: move Dotty, keep the pace. */
  | { kind: "moved" };

/**
 * The reader is ahead of Dotty: how fast have they been reading since the two
 * last agreed? Too little to go on, or too fast to be reading (a jump ahead),
 * moves Dotty to them without touching its pace.
 */
export const judgeCatchUp = (options: { words: number; activeMs: number; dottyWpm: number }): CatchUp => {
  if (options.activeMs < 15_000 || options.words < 40) {
    return { kind: "moved" };
  }
  const wpm = options.words / (options.activeMs / 60000);
  if (!Number.isFinite(wpm) || wpm > Math.min(900, options.dottyWpm * 2.4) || wpm <= options.dottyWpm * 1.06) {
    return { kind: "moved" };
  }
  return { kind: "faster", wpm };
};
