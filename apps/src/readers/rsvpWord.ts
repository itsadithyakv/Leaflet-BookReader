/**
 * Where a word sits on SpeedRead's stage.
 *
 * One letter of each word (the pivot, in the accent colour) is held at the
 * same spot on screen, so the eye never has to move. That letter is left of
 * the word's middle, because that is where the eye lands when it reads; so
 * the rest of the word runs off to its right. Two things made that feel
 * lopsided, long words most of all:
 *
 * - The pivot was counted in letters (the 2nd, 3rd, 4th or 5th, by length),
 *   which for a long word is only a quarter of the way in: three quarters of
 *   "extraordinarily" hung to the right. It is now about 36% of the way
 *   through the word as drawn, by the letters' widths, so an "illicit" and a
 *   "mammoth" are both held where they look held.
 * - The spot was the middle of the stage. It is now a little left of the
 *   middle (`RSVP_ANCHOR`), so that a word of ordinary length sits across the
 *   middle of the screen instead of starting there.
 *
 * And a word too long for the room on either side of the spot is set a
 * little smaller rather than cut off at the stage's edge.
 */

/** Where the pivot is held: this share of the stage's width from its left. */
export const RSVP_ANCHOR = 0.42;

/**
 * The same spot, said the way the stage draws it: this many ems of the
 * stage's type left of its middle. As a share of the stage's width it was in
 * a different place for every window: the type grows with the window but the
 * stage stops at 720px, so on a small window (smaller type, same stage) the
 * spot was a letter and a half left of the middle and every word sat left.
 * Half an em and a bit is where the pivot of an ordinary word is from the
 * word's own middle, so ordinary words sit across the middle at every size.
 */
export const RSVP_ANCHOR_EM = 0.55;

/** Room kept clear at each edge of the stage when a word is fitted by its real width. */
export const RSVP_EDGE = 0.96;

/** How far through a word, by width, the eye rests. */
const PIVOT_AT = 0.36;

/**
 * The stage's width in ems of the word's type, at its tightest (a narrow
 * window): the type is `clamp(2.4rem, 5.2vw, 4.4rem)` on a stage of at most
 * 720px. A wider window has more room than this; fitting to the tightest
 * means a word is never cut off anywhere.
 */
const STAGE_EM = 9;
/** Room kept clear at each edge of the stage. */
const EDGE = 0.94;

const NARROW = new Set("iljtfrI.,;:!'’‘|()[]-".split(""));
const WIDE = new Set("mwMW@—".split(""));

/** A letter's width in ems of a bold book serif: close enough to tell "illicit" from "mammoth". */
export const glyphEm = (char: string) => {
  if (NARROW.has(char)) return 0.33;
  if (WIDE.has(char)) return 0.88;
  if (char >= "A" && char <= "Z") return 0.72;
  if (char >= "0" && char <= "9") return 0.58;
  return /\p{L}/u.test(char) ? 0.55 : 0.4;
};

const isLetter = (char: string | undefined) => Boolean(char) && /[\p{L}\p{N}]/u.test(char as string);

/**
 * The letter the eye rests on. Leading quotes and brackets are skipped, so
 * "“Hello" pivots on the e, not the quote; a short word pivots on its second
 * letter; a longer one on the letter whose middle is nearest 36% of the way
 * through the word as drawn. Never a hyphen or an apostrophe.
 */
export const rsvpPivotIndex = (text: string) => {
  const last = Math.max(0, text.length - 1);
  const lead = text.match(/^[“"'‘(\[]*/)?.[0].length ?? 0;
  const length = Math.max(1, text.length - lead);
  if (length <= 1) {
    return Math.min(last, lead);
  }
  if (length <= 5) {
    return Math.min(last, lead + 1);
  }
  const widths = Array.from({ length }, (_, index) => glyphEm(text[lead + index]));
  const total = widths.reduce((sum, width) => sum + width, 0);
  let best = 1;
  let nearest = Number.POSITIVE_INFINITY;
  let before = 0;
  for (let index = 0; index < length; index += 1) {
    const middle = before + widths[index] / 2;
    before += widths[index];
    // The first letter is never the pivot of a long word, nor is a mark between letters.
    if (index === 0 || !isLetter(text[lead + index])) {
      continue;
    }
    const distance = Math.abs(middle - total * PIVOT_AT);
    if (distance < nearest) {
      nearest = distance;
      best = index;
    }
  }
  return Math.min(last, lead + best);
};

/** Bold Georgia runs a little wider than `glyphEm` says (measured: about an eighth). */
const estimatedEm = (text: string) => Array.from(text).reduce((sum, char) => sum + glyphEm(char), 0) * 1.14;

/**
 * How far a word reaches either side of the middle of its pivot letter, in
 * ems of its type: what the stage needs to know to fit it. `shown` is the
 * word with its punctuation; `widthOf` measures text in ems (the stage
 * measures the real letters; the estimate stands in where it cannot).
 */
export const rsvpExtents = (shown: string, pivot: number, widthOf: (text: string) => number = estimatedEm) => {
  const chars = Array.from(shown);
  const at = Math.min(Math.max(0, pivot), Math.max(0, chars.length - 1));
  const half = widthOf(chars[at] ?? "") / 2;
  return {
    left: widthOf(chars.slice(0, at).join("")) + half,
    right: half + widthOf(chars.slice(at + 1).join(""))
  };
};

/**
 * How much smaller to set a word (1: as it is) so that what lies either side
 * of its pivot fits the room either side of the spot. `shown` is the word with
 * whatever follows it on the stage (its punctuation).
 */
export const rsvpFit = (shown: string, pivot: number) => {
  const widths = Array.from(shown, glyphEm);
  const half = (widths[pivot] ?? 0) / 2;
  const left = widths.slice(0, pivot).reduce((sum, width) => sum + width, 0) + half;
  const right = widths.slice(pivot + 1).reduce((sum, width) => sum + width, 0) + half;
  const roomLeft = STAGE_EM * RSVP_ANCHOR * EDGE;
  const roomRight = STAGE_EM * (1 - RSVP_ANCHOR) * EDGE;
  const fit = Math.min(1, left > 0 ? roomLeft / left : 1, right > 0 ? roomRight / right : 1);
  // Two decimals: a style value that does not change for every word.
  return Math.max(0.4, Math.floor(fit * 100) / 100);
};
