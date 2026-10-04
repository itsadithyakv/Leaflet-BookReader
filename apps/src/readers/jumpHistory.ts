/**
 * Back to where you were. A jump (a link in the book, a chapter picked from
 * the list, a search result, a bookmark or highlight opened, the progress
 * bar) leaves the line that was being read; this remembers it, so one press
 * returns there, and another goes forward again. Like a browser's history,
 * but only of jumps: ordinary reading (scrolling, turning pages) adds nothing.
 *
 * Places are CFIs of the reading line. Kept for the visit only; cleared when
 * the book closes.
 */

export type JumpHistory = { back: readonly string[]; forward: readonly string[] };

/** How many places are kept; the oldest go first. */
export const JUMP_LIMIT = 20;

export const NO_JUMPS: JumpHistory = { back: [], forward: [] };

/**
 * The reader is being taken elsewhere from `from`. What lay forward is let
 * go, as a browser does. A place not known, or the one already on top (two
 * jumps from the same line), adds nothing.
 */
export const noteJump = (history: JumpHistory, from: string | null, limit = JUMP_LIMIT): JumpHistory => {
  if (!from) {
    return history.forward.length > 0 ? { back: history.back, forward: [] } : history;
  }
  const back = history.back[history.back.length - 1] === from ? history.back : [...history.back, from].slice(-limit);
  return { back, forward: [] };
};

/**
 * One step back: where to go, and the history after going. The place being
 * left (`current`) is what "forward" returns to; going back is not itself a
 * new place to come back from.
 */
export const stepBack = (history: JumpHistory, current: string | null, limit = JUMP_LIMIT) => {
  const target = history.back[history.back.length - 1];
  if (target === undefined) {
    return null;
  }
  const forward = current && current !== target ? [...history.forward, current].slice(-limit) : history.forward;
  return { target, history: { back: history.back.slice(0, -1), forward } as JumpHistory };
};

/** One step forward again, after going back. */
export const stepForward = (history: JumpHistory, current: string | null, limit = JUMP_LIMIT) => {
  const target = history.forward[history.forward.length - 1];
  if (target === undefined) {
    return null;
  }
  const back = current && current !== target ? [...history.back, current].slice(-limit) : history.back;
  return { target, history: { back, forward: history.forward.slice(0, -1) } as JumpHistory };
};
