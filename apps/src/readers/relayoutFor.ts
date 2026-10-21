/**
 * What a change of the window's size asks of the book (useResizeRelayout).
 *
 * Scrolling, a column is laid out by its width alone: a change of height (a
 * phone's keyboard coming or going, the system bars, the window dragged
 * taller) leaves every line where it was, and laying the book out again for
 * it only moved the reader. epub.js did it anyway, at its own hearing of the
 * resize: it emptied the page and went back to where it last said the
 * reader was. A search result tapped with the keyboard up went there, the
 * keyboard went down, and the page went back to the place before the
 * search. Now a change of height while scrolling only tells epub.js how
 * tall the window is.
 *
 * With pages the height is the page's, and the book is laid out again,
 * except for the keyboard coming up over it (it stays laid out as it was,
 * under the keyboard, and is just as it was when the keyboard goes). A
 * keyboard that is not ours (a reply typed into another app's notification)
 * cannot be told from the window being made shorter: a change of height is
 * laid out only once it has held for a moment (`settle`), and not at all if
 * the height has come back by then (the keyboard came and went).
 */

export type Size = { width: number; height: number };
export type Relayout = "none" | "bounds" | "settle" | "relayout";

/** With pages, a change of height is laid out once it has held this long. */
export const SETTLE_HEIGHT_MS = 1200;

export const relayoutFor = (layout: "scroll" | "pages", from: Size, to: Size, keyboardUp: boolean): Relayout => {
  if (from.width === to.width && from.height === to.height) {
    return "none";
  }
  if (from.width === to.width) {
    if (layout === "scroll") {
      return "bounds";
    }
    if (to.height < from.height && keyboardUp) {
      return "none";
    }
    return "settle";
  }
  return "relayout";
};

/**
 * By a finger a new width is a turn of the screen (a keyboard changes only the
 * height). It is not laid out as it comes: the window passes through sizes
 * that are neither way up, and epub.js laid the book out at each, then again
 * at the last one. Under the veil (readers/readerVeil.ts) the turn waits for
 * the window to keep its size (`TURN_SETTLE_MS`) and is laid out once, at the
 * size it ends at; any change while it waits, a change of height included
 * (the bars coming back), is part of it. A mouse's window is laid out as
 * before.
 */
export const resizeDuringTurn = (need: Relayout, touch: boolean, turning: boolean): Relayout | "turn" => {
  if (!touch) {
    return need;
  }
  if (need === "relayout" || (turning && need !== "none")) {
    return "turn";
  }
  return need;
};
