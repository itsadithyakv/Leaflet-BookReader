/** Types shared by the reader and its helpers. */

export type TocItem = {
  id?: string;
  label: string;
  href: string;
  subitems?: TocItem[];
};

export type ReaderDisplayMode = "paper" | "dark-paper" | "true-white" | "true-black" | "app";
export type ReadingMode = "standard" | "smart" | "speed";

export type ReaderWord = {
  text: string;
  trailing: string;
  node: Text;
  start: number;
  end: number;
  difficulty: number;
  rsvpPauseMultiplier: number;
  sentenceEnd: boolean;
  paragraphEnd: boolean;
  iframe: HTMLIFrameElement;
};

export type ReadingWordState = {
  index: number;
  total: number;
  text: string;
  /** Punctuation after the word ("," or ".”"), shown in RSVP so sentences still read as sentences. */
  punctuation: string;
  contextStart: number;
  context: Array<{ text: string; trailing: string; index: number }>;
};

/** Smart Read through one chapter. */
export type SmartSession = {
  startedAt: number;
  /** Time Dotty was moving: pauses, waits and time away are left out. */
  activeMs: number;
  lastTickAt: number;
  /** Where the reader and Dotty last agreed, which the reader's own pace is measured from. */
  anchorIndex: number;
  anchorActiveMs: number;
  /** Read at Dotty's pace since then with no correction: a sign the pace suits. */
  acceptedWords: number;
  acceptedMs: number;
};

/** Scrolling through a chapter, or turning pages. */
export type ReaderLayout = "scroll" | "pages";

export const LAYOUT_KEY = "leaflet.reader.layout";

export const readLayout = (): ReaderLayout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "pages" ? "pages" : "scroll";
  } catch {
    return "scroll";
  }
};

/**
 * How long a line of text may run. Lines across a whole wide window (2,000
 * pixels and more in full screen) are hard to follow from one end to the next,
 * so the text sits in a column; the space either side is page. Kept per
 * device, like the layout: it depends on the screen, not the book.
 */
export type ReaderMeasure = "narrow" | "medium" | "wide" | "full";

export const MEASURE_KEY = "leaflet.reader.measure";

/**
 * The longest line for each, in em of the reading size, so a column holds the
 * same number of characters whatever the type size: about 60, 72 and 90 of a
 * book face. Full has no limit.
 */
export const MEASURE_EM: Record<ReaderMeasure, number | null> = { narrow: 28, medium: 34, wide: 42, full: null };

export const readMeasure = (): ReaderMeasure => {
  try {
    const value = localStorage.getItem(MEASURE_KEY);
    return value === "narrow" || value === "wide" || value === "full" ? value : "medium";
  } catch {
    return "medium";
  }
};

/** The column's width for the book's own stylesheet: `100vw` (the frame's width) when there is no limit. */
export const measureCss = (measure: ReaderMeasure) => {
  const em = MEASURE_EM[measure];
  return em === null ? "100vw" : `${em}em`;
};

/**
 * Each side's padding in the scrolling layout: the usual gutter, or half the
 * room the column leaves, whichever is more. The text stays centred, and a
 * narrow window keeps its gutter.
 */
export const MEASURE_PADDING =
  "max(var(--reader-content-pad, 24px), calc((100vw - var(--reader-measure, 100vw)) / 2))";

/**
 * With pages, epub.js lays its columns out across the viewer, so the viewer
 * itself is narrowed: the column plus room for epub.js's gap and the page's
 * edges. Null when there is no limit.
 */
export const pagesViewerMaxWidth = (measure: ReaderMeasure, fontSize: number) => {
  const em = MEASURE_EM[measure];
  return em === null ? null : Math.round(em * fontSize + 96);
};
