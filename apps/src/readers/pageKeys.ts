/**
 * What the reading keys do in the page reader.
 *
 * A page wider or taller than the window is read by scrolling it, so the keys
 * scroll first and turn the page only when there is nothing further that way:
 * Space at the bottom of a page goes to the top of the next, and Shift+Space
 * at the top goes to the bottom of the one before, so reading backwards
 * carries on where the eye is. A page that fits is turned at once. The arrows
 * used to turn the page always, and a zoomed page could not be read by
 * keyboard at all.
 */

export type ReadingDirection = "ltr" | "rtl";

/** The scrolling stage, as far as the keys need it. */
export type StageMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  /**
   * The room the stage keeps above and below the page, with nothing in it to
   * read (its padding; below, less what the dock covers). Left out where the
   * stage holds a whole column of pages.
   */
  padTop?: number;
  padBottom?: number;
};

export type KeyAction =
  /** Turn by one page; `land` is the end of the new page to show. */
  | { kind: "turn"; step: 1 | -1; land: "top" | "bottom" }
  | { kind: "scroll"; top?: number; left?: number }
  | { kind: "goto"; page: "first" | "last" };

/** An arrow key moves the page by this much. */
const LINE_STEP = 80;
/** Space and Page Down move it by this share of the window, so a line or two carries over. */
const SCREEN_SHARE = 0.86;
/** Scroll positions are whole device pixels; an edge is reached within this. */
const EDGE = 2;

/** Which way a press of the left or right side (arrow key, dock arrow, third of the page) turns. */
export const sideStep = (side: "left" | "right", direction: ReadingDirection): 1 | -1 =>
  (side === "right") === (direction === "ltr") ? 1 : -1;

/**
 * The page is turned once its own end is in view, not the scroller's: the
 * stage has room round the page, and a press that only moved the page a few
 * pixels into that room showed the reader nothing and looked like a key that
 * had not worked (at fit width, one such press on every page).
 */
const vertical = (stage: StageMetrics, step: 1 | -1, amount: number): KeyAction => {
  const end = Math.max(0, stage.scrollHeight - stage.clientHeight);
  if (step > 0) {
    return stage.scrollTop >= end - Math.max(0, stage.padBottom ?? 0) - EDGE
      ? { kind: "turn", step: 1, land: "top" }
      : { kind: "scroll", top: Math.min(end, stage.scrollTop + amount) };
  }
  return stage.scrollTop <= Math.max(0, stage.padTop ?? 0) + EDGE
    ? { kind: "turn", step: -1, land: "bottom" }
    : { kind: "scroll", top: Math.max(0, stage.scrollTop - amount) };
};

const horizontal = (stage: StageMetrics, side: "left" | "right", direction: ReadingDirection): KeyAction => {
  const end = Math.max(0, stage.scrollWidth - stage.clientWidth);
  const turn: KeyAction = { kind: "turn", step: sideStep(side, direction), land: "top" };
  if (end <= EDGE) {
    return turn;
  }
  if (side === "right") {
    return stage.scrollLeft >= end - EDGE ? turn : { kind: "scroll", left: Math.min(end, stage.scrollLeft + LINE_STEP) };
  }
  return stage.scrollLeft <= EDGE ? turn : { kind: "scroll", left: Math.max(0, stage.scrollLeft - LINE_STEP) };
};

/**
 * The action for a key, or null when it is not a reading key. Keys held with
 * Ctrl, Alt or the Meta key are the caller's (zoom, find) or the system's.
 */
export const readingKeyAction = (
  event: { key: string; shiftKey?: boolean },
  stage: StageMetrics,
  direction: ReadingDirection = "ltr"
): KeyAction | null => {
  const screen = Math.max(LINE_STEP, stage.clientHeight * SCREEN_SHARE);
  switch (event.key) {
    case " ":
    case "Spacebar":
      return vertical(stage, event.shiftKey ? -1 : 1, screen);
    case "PageDown":
      return vertical(stage, 1, screen);
    case "PageUp":
      return vertical(stage, -1, screen);
    case "ArrowDown":
      return vertical(stage, 1, LINE_STEP);
    case "ArrowUp":
      return vertical(stage, -1, LINE_STEP);
    case "ArrowRight":
      return horizontal(stage, "right", direction);
    case "ArrowLeft":
      return horizontal(stage, "left", direction);
    case "Home":
      return { kind: "goto", page: "first" };
    case "End":
      return { kind: "goto", page: "last" };
    default:
      return null;
  }
};

/**
 * A click on a comic's page: the left or right third turns, the middle does
 * nothing (it is where a reader rests the pointer). `x` is how far across the
 * page the click was, 0 to 1.
 */
export const clickTurn = (x: number, direction: ReadingDirection): 1 | -1 | 0 =>
  x < 1 / 3 ? sideStep("left", direction) : x > 2 / 3 ? sideStep("right", direction) : 0;

/** What is typed into "go to page", as a page of the document, or null when it is not one. */
export const parsePageEntry = (entry: string, pageCount: number): number | null => {
  const text = entry.trim();
  if (pageCount <= 0 || text.length === 0) {
    return null;
  }
  // "40%" goes that far through the document.
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(text);
  if (percent) {
    const share = Math.min(100, Number(percent[1])) / 100;
    return Math.min(pageCount, Math.max(1, Math.round(share * (pageCount - 1)) + 1));
  }
  if (!/^\d+$/.test(text)) {
    return null;
  }
  return Math.min(pageCount, Math.max(1, Number(text)));
};

/** How far through the document a page is, as a whole percentage. */
export const pagePercent = (page: number, pageCount: number) =>
  pageCount <= 1 ? (pageCount === 1 ? 100 : 0) : Math.round(((page - 1) / (pageCount - 1)) * 100);
