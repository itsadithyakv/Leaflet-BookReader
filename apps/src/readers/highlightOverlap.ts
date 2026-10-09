/**
 * A selection made over words that are highlighted already.
 *
 * Highlighting them again used to lay a second highlight on the first: the
 * colour doubled where the two met, and removing one left the other looking
 * as if nothing had been removed. Now a selection inside a highlight is that
 * highlight (its colour can be changed, nothing is added), and one that runs
 * past a highlight's end grows it: the highlights it touches become one, over
 * all their words, with their notes.
 *
 * Works on the ranges of one document (a chapter on the page). The numbers
 * are `Range`'s own constants, written out because a chapter's document is
 * in a frame with a `Range` of its own.
 */

const START_TO_START = 0;
const START_TO_END = 1;
const END_TO_END = 2;
const END_TO_START = 3;

/** A highlight as it lies on the page. */
export type Laid = { id: string; range: Range };

const sameDocument = (a: Range, b: Range) => a.startContainer.ownerDocument === b.startContainer.ownerDocument;

/** Whether two ranges share any words. Two that only meet end to start do not. */
export const overlaps = (a: Range, b: Range) =>
  sameDocument(a, b) && a.compareBoundaryPoints(START_TO_END, b) > 0 && a.compareBoundaryPoints(END_TO_START, b) < 0;

/** Whether `outer` holds all of `inner`. */
export const covers = (outer: Range, inner: Range) =>
  sameDocument(outer, inner) && outer.compareBoundaryPoints(START_TO_START, inner) <= 0 && outer.compareBoundaryPoints(END_TO_END, inner) >= 0;

export type Under = {
  /** The highlights the selection shares words with. */
  over: Laid[];
  /** The one that holds the whole selection already, when one does. */
  within: Laid | null;
  /** The selection and everything in `over`, as one range. */
  whole: Range;
};

/** What a selection lies over. */
export const highlightsUnder = (picked: Range, laid: readonly Laid[]): Under => {
  const over = laid.filter((one) => overlaps(picked, one.range));
  const whole = picked.cloneRange();
  for (const one of over) {
    if (one.range.compareBoundaryPoints(START_TO_START, whole) < 0) {
      whole.setStart(one.range.startContainer, one.range.startOffset);
    }
    if (one.range.compareBoundaryPoints(END_TO_END, whole) > 0) {
      whole.setEnd(one.range.endContainer, one.range.endOffset);
    }
  }
  return { over, within: over.find((one) => covers(one.range, picked)) ?? null, whole };
};

/** The notes of several highlights as one, each once, in the order given. */
export const joinNotes = (notes: Array<string | null | undefined>): string | null => {
  const kept: string[] = [];
  for (const note of notes) {
    const text = note?.trim();
    if (text && !kept.includes(text)) {
      kept.push(text);
    }
  }
  return kept.length > 0 ? kept.join("\n\n") : null;
};
