/** Smart Read and speed reading: where the eye rests, and how long each word is held. */

import type { ReaderWord } from "./readerTypes";

/** Where the eye rests in a word shown on its own, and how the word is fitted to the stage: see `rsvpWord.ts`. */
export { rsvpPivotIndex, rsvpFit, RSVP_ANCHOR } from "./rsvpWord";
export { rsvpStageVars } from "./rsvpMeasure";

/** How SpeedRead holds a new name or word longer, and eases off after Play: see `rsvpHold.ts`. */
export { noveltyHolds, rsvpRamp, MAX_WORD_HOLD } from "./rsvpHold";

/**
 * A word of the book's text: letters and digits, with apostrophes and hyphens
 * inside it ("wouldn’t", "mother-in-law"), and a figure kept whole ("1,200",
 * "3.5") instead of being read out as two numbers.
 */
export const READER_WORD_PATTERN = /[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+|(?<=\p{N})[.,]\p{N}+)*/gu;

/** How long auto-scroll or Smart Read keeps crediting time after the last real input, when it pauses for a reader gone still. */
export const HANDS_FREE_GRACE_MS = 5 * 60_000;
/**
 * And when it does not pause: an hour. The page reads on for as long as it is
 * left to, which is the point of it for a reader who sits back and never
 * touches anything; but a night left running is not a night of reading, and
 * the minutes go on a board other readers are on.
 */
export const HANDS_FREE_UNPAUSED_MS = 60 * 60_000;

/**
 * "Pause when I've been still" (Settings, Reading). Smart Read, SpeedRead and
 * auto-scroll used to stop after five minutes without a key or the pointer,
 * always: to a reader following Dotty with their hands in their lap that is
 * a book that keeps stopping. Off unless the reader turns it on.
 */
export const PAUSE_WHEN_STILL_KEY = "leaflet.reader.pauseWhenStill";

export const pausesWhenStill = (): boolean => {
  try {
    return localStorage.getItem(PAUSE_WHEN_STILL_KEY) === "1";
  } catch {
    return false;
  }
};

export const setPausesWhenStill = (on: boolean) => {
  try {
    if (on) {
      localStorage.setItem(PAUSE_WHEN_STILL_KEY, "1");
    } else {
      localStorage.removeItem(PAUSE_WHEN_STILL_KEY);
    }
  } catch {
    // Storage that cannot be written: the choice stays as it was.
  }
};

/** Whether hands-free reading stops now, `quietMs` after the last touch. */
export const stillTooLong = (quietMs: number, pauses = pausesWhenStill()) => pauses && quietMs >= HANDS_FREE_GRACE_MS;

/** Whether hands-free reading is still credited as reading, `quietMs` after the last touch. */
export const handsFreeCounts = (quietMs: number, pauses = pausesWhenStill()) => quietMs < (pauses ? HANDS_FREE_GRACE_MS : HANDS_FREE_UNPAUSED_MS);

export const READER_BLOCK_SELECTOR =
  "p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, dd, dt, td, th, figcaption, div, section, article, body";
/**
 * A word that ends a sentence, by what follows it up to the next word: a
 * full stop, question or exclamation mark, any closing quotes or brackets,
 * and then, after the space, any quote or bracket that opens what comes next.
 * That last part belongs to the word before it in the index (text before the
 * first word of a node does), so `said. “I will` leaves "said" with `. “`.
 * Without it no sentence that was followed by speech counted as ended: 171
 * of the 1,169 in one chapter of a novel, each read on into the speech with
 * no pause. Nor did one closed by a single quote (’), as British books do.
 */
export const SENTENCE_END_PATTERN = /[.!?][”"’')\]]*\s*[“‘"'(\[]*\s*$/;

/** True when nothing but inline markup separates the end of `a` from the start of `b`. */
export const isInlineJoin = (a: Text, b: Text) => {
  try {
    const range = a.ownerDocument.createRange();
    range.setStart(a, a.data.length);
    range.setEnd(b, 0);
    return (
      range.toString() === "" && !range.cloneContents().querySelector("br, img, hr, svg, image")
    );
  } catch {
    return false;
  }
};

/**
 * Time a word is held for, in units of one word at the nominal WPM. Pauses are
 * relative so they shrink with speed: a fixed 620ms paragraph pause is a blink
 * at 150 WPM and ten words' worth at 1000. In Smart Read a harder word than
 * the chapter's average gets longer, an easier one less; the chapter's own
 * difficulty is already in its pace (see paceModel), so this only spreads it.
 */
export const getPaceFactor = (word: ReaderWord, mode: "speed" | "smart", averageDifficulty = 1) =>
  (mode === "speed" ? word.rsvpPauseMultiplier : word.difficulty / Math.max(0.5, averageDifficulty)) +
  (word.paragraphEnd ? 1.6 : word.sentenceEnd ? 0.9 : /[,;:—–]\s*$/.test(word.trailing) ? 0.4 : 0);

/**
 * Scales the per-word factors so a section averages out at the chosen WPM. The
 * pauses used to be added on top, so "600 WPM" actually ran at about 400.
 */
export const getPaceScale = (words: ReaderWord[], mode: "speed" | "smart", averageDifficulty = 1) => {
  if (words.length === 0) return 1;
  const total = words.reduce((sum, word) => sum + getPaceFactor(word, mode, averageDifficulty), 0);
  return Math.min(1, Math.max(0.55, words.length / Math.max(1, total)));
};
