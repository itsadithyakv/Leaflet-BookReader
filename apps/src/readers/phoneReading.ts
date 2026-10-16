import { describeMinutesShort } from "./timeLeft";

/**
 * Reading on a phone (docs/android.md, "The reader"): the faint line at the
 * foot of the page, the bookmark corner, and the way back after a jump. Pure,
 * so they can be tested on their own; drawn by readers/text/PhoneReadingMarks.tsx.
 */

// ---- The footer: one quiet line under the text --------------------------------

/** What the footer says, in the order a tap on it goes through them. */
export type FooterMode = "chapter" | "book" | "place" | "clock";
export const FOOTER_MODES: readonly FooterMode[] = ["chapter", "book", "place", "clock"];
export const FOOTER_MODE_KEY = "leaflet.reader.footer";

export const readFooterMode = (stored: string | null): FooterMode =>
  FOOTER_MODES.includes(stored as FooterMode) ? (stored as FooterMode) : "chapter";

export type FooterFacts = {
  /** Minutes left in the chapter and in the book (readers/timeLeft.ts); null with no pace yet. */
  chapter: number | null;
  book: number | null;
  /** How far through the book, 0..1; null until known. */
  progress: number | null;
  /** With pages: the page in the chapter. */
  pageOf: { page: number; total: number } | null;
  /** The time now, as the phone shows it ("9:41"). */
  clock: string;
  /**
   * The status bar is away (an upright phone, readers/touchLayout.ts
   * `systemBarsHidden`): the time leads every line, and is not a line of
   * its own.
   */
  clockLeads: boolean;
};

/** What a mode says, or null when there is nothing to say yet (no pace, no place). */
const modeText = (mode: FooterMode, facts: FooterFacts): string | null => {
  switch (mode) {
    case "chapter":
      return facts.chapter === null ? null : `${describeMinutesShort(facts.chapter)} left in chapter`;
    case "book":
      return facts.book === null ? null : `${describeMinutesShort(facts.book)} left in book`;
    case "place": {
      if (facts.progress === null) {
        return null;
      }
      const percent = `${Math.round(facts.progress * 100)}%`;
      return facts.pageOf && facts.pageOf.total > 1 ? `Page ${facts.pageOf.page} of ${facts.pageOf.total} · ${percent}` : percent;
    }
    case "clock":
      return facts.clockLeads ? null : facts.clock;
  }
};

/** The mode shown for the one chosen: it, or the next that has something to say. */
export const shownFooterMode = (chosen: FooterMode, facts: FooterFacts): FooterMode | null => {
  const from = FOOTER_MODES.indexOf(chosen);
  for (let step = 0; step < FOOTER_MODES.length; step += 1) {
    const mode = FOOTER_MODES[(from + step) % FOOTER_MODES.length];
    if (modeText(mode, facts) !== null) {
      return mode;
    }
  }
  return null;
};

/** A tap on the footer: the next mode after the one shown that has something to say. */
export const nextFooterMode = (shown: FooterMode, facts: FooterFacts): FooterMode => {
  const from = FOOTER_MODES.indexOf(shown);
  for (let step = 1; step <= FOOTER_MODES.length; step += 1) {
    const mode = FOOTER_MODES[(from + step) % FOOTER_MODES.length];
    if (modeText(mode, facts) !== null) {
      return mode;
    }
  }
  return shown;
};

/** The footer's line for the chosen mode: "9:41 · 12 min left in chapter", "34%", "9:41". */
export const footerText = (chosen: FooterMode, facts: FooterFacts): string => {
  const mode = shownFooterMode(chosen, facts);
  const text = mode === null ? null : modeText(mode, facts);
  if (!facts.clockLeads) {
    return text ?? "";
  }
  return text ? `${facts.clock} · ${text}` : facts.clock;
};

// ---- The bookmark corner -----------------------------------------------------

/** The top right corner of the page that bookmarks, in px each way (a thumb's tap). */
export const CORNER_PX = 56;

/** Whether a tap at window point (x, y) falls in the bookmark corner of a page whose box is given. */
export const inBookmarkCorner = (x: number, y: number, page: { left: number; top: number; width: number }) =>
  page.width > CORNER_PX * 2 && x >= page.left + page.width - CORNER_PX && x <= page.left + page.width && y >= page.top && y <= page.top + CORNER_PX;

/**
 * The bookmarks on the page showing: those whose place lies from its first
 * line to its last (`compare` is epub.js's CFI order).
 */
export const bookmarksShowing = <T extends { cfi: string }>(
  bookmarks: readonly T[],
  start: string | null | undefined,
  end: string | null | undefined,
  compare: (a: string, b: string) => number
): T[] => {
  if (!start) {
    return [];
  }
  const last = end || start;
  return bookmarks.filter((mark) => {
    try {
      return compare(mark.cfi, start) >= 0 && compare(mark.cfi, last) <= 0;
    } catch {
      return false;
    }
  });
};

// ---- Back after a jump ---------------------------------------------------------

/** How long the way back shows after a jump, unless the reader moves on first. */
export const BACK_CHIP_MS = 7000;

/** Where a jump left from, and when: the place the chip offers to go back to. */
export type JumpedFrom = { chapter: string | null; progress: number | null };
export type BackChip = { at: number; from: JumpedFrom } | null;

/** Where the jump left from, as the chip names it: the chapter when the jump left it, else how far through. */
export const backChipLabel = (from: JumpedFrom, now: { chapter: string | null }) => {
  if (from.chapter && from.chapter !== now.chapter) {
    return from.chapter;
  }
  return from.progress === null ? "where you were" : `${Math.round(from.progress * 100)}%`;
};

/** The chip shows from the jump for `BACK_CHIP_MS`, while there is somewhere to go back to. */
export const backChipShown = (chip: BackChip, now: number, canGoBack: boolean) =>
  chip !== null && canGoBack && now - chip.at < BACK_CHIP_MS;
