/**
 * Smart Read turns the page by scrolling. Dotty reads down to near the bottom
 * of what is visible, then the page moves up in one step, bringing Dotty's line
 * to near the top: a page turn, not a nudge every few lines. It used to keep
 * Dotty around the middle, which meant a small scroll every five or six lines.
 *
 * Everything is worked out from the reading area actually on screen, in pixels
 * and in lines, so the same rules suit a small laptop, a tall portrait monitor,
 * a wide window and large type alike.
 */

export type ReadingArea = {
  /** The scrolling container's visible height. */
  height: number;
  /** One line of text, in pixels. */
  lineHeight: number;
  /** Covered at the top (the toolbar, when it is showing). */
  topInset: number;
  /** Covered at the bottom (Smart Read's controls, the chapter bar). */
  bottomInset: number;
  /**
   * A phone: Dotty reads down to just above the foot of the text, and the
   * page glides its line up to a couple of lines under the top, most of a
   * screen at a time, more slowly than a computer's step, and then rests a
   * moment (`settleDuration`). The glide used to be a third of the screen,
   * seven lines every quarter of a minute, which wasted the screen and kept
   * the page moving.
   */
  phone?: boolean;
};

type Box = { top: number; bottom: number };

/**
 * How much of a box (the scrolling text) a bar covers from the top: only a
 * bar along its top edge and on screen. An upright phone's text reader has
 * its bar at the foot, and a hidden bar is moved off the window: taken for a
 * bar at the top, either put the reading area below the window, so Smart
 * Read scrolled at every word with Dotty off the foot of the screen.
 */
export const coverFromTop = (box: Box, bar: Box | null | undefined) =>
  bar && bar.top <= box.top + 1 && bar.bottom > box.top ? Math.min(box.bottom - box.top, bar.bottom - box.top) : 0;

/**
 * How much of a box the lowest-reaching of some things over its foot covers
 * (the pace pill, the chapter dock, an upright phone's bar, the footer
 * strip): only those in its lower half and on screen count.
 */
export const coverFromBottom = (box: Box, covers: Array<Box | null | undefined>) => {
  const middle = (box.top + box.bottom) / 2;
  let covered = 0;
  for (const cover of covers) {
    if (!cover || cover.top >= box.bottom || cover.bottom <= middle || cover.top < middle) continue;
    covered = Math.max(covered, box.bottom - cover.top);
  }
  return covered;
};

export type ReadingBand = {
  /** Where Dotty's line lands after a step, from the top of the container. */
  top: number;
  /** The step happens when Dotty's line reaches this far down. */
  turn: number;
};

export const readingBand = (area: ReadingArea): ReadingBand => {
  const line = Math.max(12, area.lineHeight);
  const visibleTop = Math.max(0, area.topInset);
  const visibleBottom = Math.max(visibleTop + line, area.height - Math.max(0, area.bottomInset));
  const usable = visibleBottom - visibleTop;
  if (area.phone) {
    // Two lines of what was just read stay above Dotty after a glide.
    const top = visibleTop + Math.max(line * 2, usable * 0.06);
    const turn = visibleBottom - Math.max(line * 1.1, usable * 0.03);
    if (turn - top >= line * 4) {
      return { top, turn };
    }
  }
  // A line and a half of what was just read stays above Dotty after a step,
  // so the eye can pick up the sentence; more on a tall screen.
  const top = visibleTop + Math.max(line * 1.5, usable * 0.08);
  // Dotty reads to within a line or so of the bottom before the page moves.
  const turn = visibleBottom - Math.max(line * 1.2, usable * 0.06);
  if (turn - top >= line * 4) {
    return { top, turn };
  }
  // Very little room (a short window, very large type): use all of it.
  return { top: visibleTop + line * 0.25, turn: Math.max(visibleTop + line * 1.5, visibleBottom - line * 0.25) };
};

/**
 * How far to scroll for Dotty's line (its top and bottom, from the top of the
 * container), or null when it can stay where it is. A line that has gone
 * above the reading area (the reader jumped back) is brought down the same way.
 */
export const planScrollStep = (lineTop: number, lineBottom: number, area: ReadingArea) => {
  const band = readingBand(area);
  if (lineBottom > band.turn || lineTop < Math.max(0, area.topInset)) {
    const delta = lineTop - band.top;
    return Math.abs(delta) >= 2 ? delta : null;
  }
  return null;
};

/**
 * How long a step's scroll takes: long enough for the eye to follow the text
 * up, short enough not to hold the reader up. Instant when the reader has
 * asked for less motion.
 */
export const stepDuration = (distance: number, reducedMotion: boolean, phone = false) =>
  reducedMotion
    ? 0
    : phone
      ? // Longer on a phone, where the step is most of the screen: 600 to 900 ms for one.
        Math.round(Math.min(950, Math.max(420, 380 + Math.abs(distance) * 0.7)))
      : Math.round(Math.min(720, Math.max(320, 260 + Math.abs(distance) * 0.35)));

/**
 * How long Dotty rests on its line after a phone's glide, before reading on:
 * time to find the line again, a little more the further the page moved
 * (about 1.2 s for most of a screen). A computer's step rests a moment only.
 * Dotty is waiting then, and the wait is not counted as reading.
 */
export const settleDuration = (distance: number, phone: boolean) =>
  phone ? Math.round(Math.min(1500, 700 + Math.abs(distance) * 0.75)) : 350;

/** Ease in and out, so a long scroll starts and lands gently. */
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * How far Page Down and Page Up move the scrolling layout: the window less
 * the strip the toolbar floats over, less two lines, so the last lines of one
 * screen are the first of the next (just under the reading line) and no line
 * is passed unseen. Never less than three lines, on a very short window.
 */
export const screenStep = (windowHeight: number, topInset: number, lineHeight: number) => {
  const line = Math.max(12, lineHeight);
  return Math.round(Math.max(line * 3, windowHeight - Math.max(0, topInset) - line * 2));
};

/**
 * Where to put the scroll position to show the end of a chapter: its last
 * line `share` of the way down the window (the next chapter's opening below
 * it), and never above the chapter's own start. `top` and `height` are the
 * chapter's frame in the scrolling container; `room` is blank kept below the
 * last line of the book.
 */
export const chapterEndTop = (top: number, height: number, room: number, windowHeight: number, share = 0.6) =>
  Math.round(Math.max(top, top + height - Math.max(0, room) - windowHeight * share));

/**
 * Whether what lies between two words in a row is something to stop at: a
 * picture, or any stretch with no words, taller than half the window. Smart
 * Read reads words, and took such a stretch in the same step that carried it
 * to the next word: a full-page map between two chapters went by in under a
 * second. `previousBottom` and `nextTop` are the bottom of the line just read
 * and the top of the line to read next, on the same scale.
 */
export const isPictureGap = (previousBottom: number, nextTop: number, windowHeight: number) =>
  windowHeight > 0 && nextTop - previousBottom > windowHeight / 2;

/**
 * Whether the reader has brought the text after such a stretch into the
 * reading area by hand (its line's top, from the top of the window), which
 * is them going on.
 */
export const pastPictureGap = (nextTop: number, area: ReadingArea) =>
  nextTop <= area.height - Math.max(0, area.bottomInset) - Math.max(12, area.lineHeight);

/**
 * Whether a change of scroll position was epub.js keeping the text where it
 * is, not anyone scrolling. When a chapter is let go above the window (or one
 * is fetched in above it) the scroll position changes by that chapter's
 * height and nothing moves on screen. A scroll by hand, a key or the reader's
 * own steps moves the text as far as the position changed.
 *
 * `scrollDelta` is how far the scroll position changed; `movedOnScreen` how
 * far a chapter that was in the window moved in it (null when that cannot be
 * told: it is then taken for scrolling, as it always was).
 *
 * Such a correction used to read as the reader scrolling. Smart Read, whose
 * next word lay below the window past a run of maps, took it for the reader
 * going back to reread and waited ("Scroll back to Dotty") until Space.
 */
export const isScrollCorrection = (scrollDelta: number, movedOnScreen: number | null) =>
  movedOnScreen !== null && Math.abs(scrollDelta) > 4 && Math.abs(movedOnScreen) <= 2;

/**
 * Where a line is against the reading area (its top, from the top of the
 * window): above it, in it, or below it. Dotty's line above is the reader
 * having read on past Dotty; below is the reader having gone back above it,
 * or Dotty having run on without them.
 */
export const lineInArea = (lineTop: number, area: ReadingArea): "above" | "in" | "below" =>
  lineTop < area.topInset ? "above" : lineTop > area.height - area.bottomInset ? "below" : "in";
