/** Smart Read and speed reading: where the eye rests, and how long each word is held. */

import type { ReaderWord } from "./readerTypes";

/**
 * Where the eye should fixate in a word shown on its own (the "optimal
 * recognition point"): slightly left of centre, by word length. Leading
 * quotes and brackets are skipped so "“Hello" pivots on the e, not the quote.
 */
export const rsvpPivotIndex = (text: string) => {
  const lead = text.match(/^[“"'‘(\[]*/)?.[0].length ?? 0;
  const length = Math.max(1, text.length - lead);
  const offset = length <= 1 ? 0 : length <= 5 ? 1 : length <= 9 ? 2 : length <= 13 ? 3 : 4;
  return Math.min(text.length - 1, lead + offset);
};

/** How long auto-scroll or Smart Read keeps crediting time after the last real input. */
export const HANDS_FREE_GRACE_MS = 5 * 60_000;

export const READER_BLOCK_SELECTOR =
  "p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, dd, dt, td, th, figcaption, div, section, article, body";
export const SENTENCE_END_PATTERN = /[.!?][”"')\]]*\s*$/;

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
