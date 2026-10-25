/**
 * A fill-in card's passage: the words in it the reader can tap to hide, the
 * ranges hidden, and the passage laid out for review with blanks.
 *
 * Ranges are `[start, end]` offsets into the passage in UTF-16 units (the
 * page's own count, and `commands/cards.rs` checks them so), end exclusive.
 *
 * Pure.
 */

export type Range = [number, number];

/** A word of the passage: where it is, and the letters of it. */
export type Token = { start: number; end: number; text: string };

/**
 * The words of a passage. A word is letters and digits with what joins them
 * ("mitral", "T4", "don't", "end-to-end", "3.5"), so that tapping one hides
 * the word and not the comma after it. Splitting by script would be better
 * for Chinese or Japanese, where a run of characters is not one word; there
 * the reader can still tap runs, which the passage breaks at punctuation.
 */
export const tokens = (passage: string): Token[] => {
  const found: Token[] = [];
  const word = /[\p{L}\p{N}\p{M}]+(?:['’\-.·][\p{L}\p{N}\p{M}]+)*/gu;
  for (let match = word.exec(passage); match; match = word.exec(passage)) {
    found.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return found;
};

/** Ranges in order, those that touch or overlap made one. */
export const mergeRanges = (ranges: Range[]): Range[] => {
  const sorted = ranges.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      out.push([start, end]);
    }
  }
  return out;
};

/** Whether a word is among the hidden ones. */
export const isHidden = (token: Token, hidden: Range[]) => hidden.some(([start, end]) => token.start >= start && token.end <= end);

/**
 * A word tapped: hidden if it was showing, showing if it was hidden. Two
 * words hidden with only spaces between them become one blank, as the reader
 * meant one term ("left ventricle").
 */
export const toggleWord = (passage: string, hidden: Range[], token: Token): Range[] => {
  const words = tokens(passage);
  const on = new Set(words.filter((word) => isHidden(word, hidden)).map((word) => word.start));
  if (on.has(token.start)) {
    on.delete(token.start);
  } else {
    on.add(token.start);
  }
  const ranges: Range[] = [];
  for (const word of words) {
    if (!on.has(word.start)) {
      continue;
    }
    const last = ranges[ranges.length - 1];
    if (last && /^\s*$/.test(passage.slice(last[1], word.start))) {
      last[1] = word.end;
    } else {
      ranges.push([word.start, word.end]);
    }
  }
  return ranges;
};

/** The passage in parts: text as it is, and the hidden runs. */
export type Part = { text: string; hidden: boolean; index: number };

export const parts = (passage: string, hidden: Range[]): Part[] => {
  const out: Part[] = [];
  let at = 0;
  mergeRanges(hidden).forEach(([start, end], index) => {
    if (start > at) out.push({ text: passage.slice(at, start), hidden: false, index: -1 });
    out.push({ text: passage.slice(start, end), hidden: true, index });
    at = end;
  });
  if (at < passage.length) out.push({ text: passage.slice(at), hidden: false, index: -1 });
  return out;
};

/** The passage with each hidden run as `[...]`, for the export. */
export const blanked = (passage: string, hidden: Range[]) =>
  parts(passage, hidden)
    .map((part) => (part.hidden ? "[...]" : part.text))
    .join("");

/** The passage as one line of plain words: what a card is made from. */
export const plainPassage = (text: string) => text.replace(/\s+/g, " ").trim();
