/**
 * A word picked by a finger (docs/android.md, "Selecting, looking up,
 * notes"): three quick taps on a word select it, as a press and hold does
 * (readers/tapRun.ts counts the taps), and the selection's bar comes up.
 */

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
