/**
 * A word picked by a double tap (docs/android.md, "Selecting, looking up,
 * notes"). By finger, two quick taps on a word select that word, as a press
 * and hold does, and the selection's bar comes up. The first tap's own work
 * (the chrome, a page turn, a pause) waits a moment for a second; a second
 * tap elsewhere, or none, lets it go ahead.
 */

/** Two taps this close in time (ms) are a double tap. Under 300, so a single tap still answers promptly. */
export const WORD_TAP_MS = 260;
/** And this close on the page (px). */
export const WORD_TAP_PX = 24;
/** A press longer than this is a hold, not a tap. */
export const WORD_TAP_HOLD_MS = 350;
/** A finger that moves further than this between down and up is not tapping. */
export const WORD_TAP_SLACK_PX = 12;

export type Tap = { at: number; x: number; y: number };

/** Whether a press, from down to up, was a tap: short and still. */
export const isQuickTap = (ms: number, moved: number) => ms <= WORD_TAP_HOLD_MS && moved <= WORD_TAP_SLACK_PX;

/** Whether `second` makes a double tap with `first` (both taps, in one document's coordinates). */
export const isWordDoubleTap = (first: Tap | null, second: Tap) =>
  first !== null && second.at >= first.at && second.at - first.at <= WORD_TAP_MS && Math.hypot(second.x - first.x, second.y - first.y) <= WORD_TAP_PX;

/** A word's letters: letters, digits and their marks, and the apostrophes and soft hyphens inside it. */
const WORD_CHAR = /[\p{L}\p{N}\p{M}'’­]/u;
/** What a word may not begin or end with: an apostrophe (a quotation mark), a soft hyphen. */
const EDGE_ONLY = /['’­]/u;
const LETTER = /[\p{L}\p{N}]/u;

/**
 * The word round a caret at `at` in `text` (the caret before or after a
 * letter), as [start, end) offsets; null when there is no word there. A
 * hyphen, a dash or any punctuation ends a word, and quotation marks are
 * left off it.
 */
export const wordAround = (text: string, at: number): { start: number; end: number } | null => {
  const chars = Array.from(text);
  // Offsets in UTF-16 units, as the DOM counts; walked by code point.
  const units: number[] = [];
  let unit = 0;
  for (const char of chars) {
    units.push(unit);
    unit += char.length;
  }
  units.push(unit);
  const indexAt = (offset: number) => {
    let index = 0;
    while (index < chars.length && units[index + 1] <= offset) index += 1;
    return index;
  };
  const isWord = (index: number) => index >= 0 && index < chars.length && WORD_CHAR.test(chars[index]);
  // The letter after the caret, or failing that the one before it.
  let index = indexAt(Math.max(0, Math.min(at, unit)));
  if (!isWord(index)) {
    if (!isWord(index - 1)) return null;
    index -= 1;
  }
  let start = index;
  let end = index + 1;
  while (isWord(start - 1)) start -= 1;
  while (isWord(end)) end += 1;
  while (start < end && EDGE_ONLY.test(chars[start])) start += 1;
  while (end > start && EDGE_ONLY.test(chars[end - 1])) end -= 1;
  if (start >= end || !chars.slice(start, end).some((char) => LETTER.test(char))) {
    return null;
  }
  return { start: units[start], end: units[end] };
};

/**
 * The first tap's work, held for a second tap: one per reader (keyed by its
 * rendition). A double tap drops it; another tap, not a double, lets it go
 * at once, so two quick taps at the two sides of a page are still both turns.
 */
type Held = { timer: ReturnType<typeof setTimeout>; run: () => void };
const held = new WeakMap<object, Held>();

/** Runs `run` once the moment for a second tap has passed (or at the next tap that is not one). */
export const holdForSecondTap = (key: object, run: () => void, wait = WORD_TAP_MS) => {
  letHeldTapGo(key);
  const entry: Held = {
    run,
    timer: globalThis.setTimeout(() => {
      if (held.get(key) === entry) held.delete(key);
      run();
    }, wait)
  };
  held.set(key, entry);
};

/** A double tap: the first tap's work is not done. */
export const dropHeldTap = (key: object) => {
  const entry = held.get(key);
  if (entry) {
    globalThis.clearTimeout(entry.timer);
    held.delete(key);
  }
};

/** Another tap that is not a double: the first tap's work is done now, ahead of this one's. */
export const letHeldTapGo = (key: object) => {
  const entry = held.get(key);
  if (entry) {
    globalThis.clearTimeout(entry.timer);
    held.delete(key);
    entry.run();
  }
};
