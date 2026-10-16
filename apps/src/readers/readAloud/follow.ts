/**
 * Following the voice on the page: the sentence being read is kept in view,
 * scrolled to the upper middle of the window, or the page turned once it has
 * moved past. A reader who moves the page themselves is left to it: the
 * reading goes on, and the page stops following until they ask again.
 */

/** A move the page makes for the voice: the scroll or page events it sets off for this long are its own. */
export const OWN_MOVE_MS = 1200;
/** A move of the page this soon after the reader's own hands (a wheel, a key, a finger) was theirs. */
export const HANDS_ON_MS = 1500;

/** Whether the page has just been moved by the reader rather than for the voice. */
export const movedByReader = ({ now, ownMoveUntil, handsOnAt }: { now: number; ownMoveUntil: number; handsOnAt: number }) =>
  now > ownMoveUntil && now - handsOnAt < HANDS_ON_MS;

/** The band of the window the sentence is kept in, as shares of its height (below the toolbar, above the controls). */
export const BAND_TOP = 0.16;
export const BAND_BOTTOM = 0.62;
/** Where a sentence brought into view is put. */
export const BRING_TO = 0.3;

/**
 * Scrolling: where to scroll so the sentence (its top and bottom, in the
 * window's pixels) sits in the band; null when it already does. A sentence
 * taller than the band is brought to its top.
 */
export const scrollTarget = ({ top, bottom, viewHeight, scrollTop }: { top: number; bottom: number; viewHeight: number; scrollTop: number }): number | null => {
  if (viewHeight <= 0) return null;
  const bandTop = viewHeight * BAND_TOP;
  const bandBottom = viewHeight * BAND_BOTTOM;
  if (top >= bandTop && (bottom <= bandBottom || top <= viewHeight * BRING_TO)) {
    return null;
  }
  return Math.max(0, Math.round(scrollTop + top - viewHeight * BRING_TO));
};

/**
 * Pages: what to do for a sentence whose first line starts `left` pixels
 * from the left of the page (the visible spread is `width` wide). "next" is
 * the page after this one, "jump" anywhere else (the voice was moved back,
 * or ran on while the page was not drawn).
 */
export const pageMove = ({ left, width, rtl = false }: { left: number; width: number; rtl?: boolean }): "stay" | "next" | "jump" => {
  if (width <= 0) return "stay";
  if (left >= -1 && left < width - 1) return "stay";
  if (!rtl && left >= width - 1 && left < width * 2) return "next";
  if (rtl && left < 0 && left >= -width) return "next";
  return "jump";
};
