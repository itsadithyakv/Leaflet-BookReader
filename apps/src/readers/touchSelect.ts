/**
 * Whether text selected under a finger was meant (docs/android.md,
 * "Selecting, looking up, notes"). A press and hold selects a word, as
 * everywhere on Android: the finger rests, the page stays still, and the word
 * is picked some 400 ms after it went down. On a phone scrolled by swipes a
 * word came up selected, with the selection bar, without anyone holding it:
 * a selection that arrives while, or just after, the page moved under the
 * finger, or sooner than a hold can make one, is not the reader's, and is let go.
 *
 * Judged only when a selection first appears after a finger's press: one
 * already there (its handles being dragged), or one made by a mouse or a
 * keyboard, is the reader's own.
 */

export type Press = {
  /** When the finger went down (ms, any clock shared with `now`). */
  at: number;
  /** "touch", "pen" or "mouse". */
  pointerType: string;
  /** The page's scroll position when it went down. */
  top: number;
  left: number;
};

/** Less than this since the press, and no hold can have selected anything (Android's long press is 400 ms or more). */
export const HOLD_MIN_MS = 300;
/** The page moving more than this under the finger was a scroll or a turn, not a hold. */
export const HOLD_SLACK_PX = 16;
/** A press older than this says nothing about a selection appearing now. */
const PRESS_STALE_MS = 10_000;

export const selectionIsAccidental = (
  press: Press | null,
  now: number,
  scroll: { top: number; left: number }
): boolean => {
  if (!press || press.pointerType !== "touch" || now - press.at > PRESS_STALE_MS) {
    return false;
  }
  if (now - press.at < HOLD_MIN_MS) {
    return true;
  }
  return Math.abs(scroll.top - press.top) > HOLD_SLACK_PX || Math.abs(scroll.left - press.left) > HOLD_SLACK_PX;
};
