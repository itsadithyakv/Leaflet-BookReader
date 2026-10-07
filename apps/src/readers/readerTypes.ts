/** Types shared by the reader and its helpers. */

import { customFamily, customFontId, isCustomTypeface, type CustomTypeface } from "./customFonts";

export type TocItem = {
  id?: string;
  label: string;
  href: string;
  subitems?: TocItem[];
  /**
   * A place inside the file, for an entry that has no id to point at (a
   * chapter list made by Leaflet, several chapters to a file): `href` is then
   * the bare file. See `tocPlace` in toc.ts.
   */
  cfi?: string;
  /**
   * This top-level entry is a whole book of a set, whatever it is called
   * (readers/innerBooks.ts takes "Book One" by its name alone for a part of
   * one novel).
   */
  book?: boolean;
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
  /** Where the word's chapter starts and ends among the words indexed (scrolling holds several chapters). */
  sectionStart: number;
  sectionEnd: number;
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

/**
 * The type itself: its face, the room between lines, and whether the right
 * edge is squared off. The text used to be Georgia at 1.8, justified, whatever
 * the reader preferred. Preferences of the device, like the line length: they
 * suit an eye and a screen, not a book.
 */
export type BuiltInTypeface = "book" | "serif" | "modern" | "sans" | "wide";
/** One of those, or a font the reader added (readers/customFonts.ts). */
export type ReaderTypeface = BuiltInTypeface | CustomTypeface;

export const TYPEFACE_KEY = "leaflet.reader.typeface";

/**
 * Faces that come with the system: no font files are shipped. Each names the
 * Windows face first, then what stands in for it on a Mac or Linux. "book" is
 * the publisher's own choice, and has no stack: nothing is imposed.
 */
export const TYPEFACE_STACK: Record<BuiltInTypeface, string | null> = {
  book: null,
  serif: 'Georgia, "Iowan Old Style", "Noto Serif", "DejaVu Serif", "Times New Roman", serif',
  modern: 'Cambria, Charter, "Bitstream Charter", "Sitka Text", "Noto Serif", Georgia, serif',
  sans: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", "Noto Sans", Arial, sans-serif',
  wide: 'Verdana, "DejaVu Sans", "Bitstream Vera Sans", Geneva, Tahoma, sans-serif'
};

/** What a book with no face of its own is set in (and the face of "serif"). */
export const FALLBACK_FACE = TYPEFACE_STACK.serif as string;

/**
 * The stack a face is set in. A font of the reader's own goes in front of
 * the book serif, which shows until the font has been read, and for good
 * when the font is no longer there: nothing has to notice that it went.
 */
export const typefaceStack = (typeface: ReaderTypeface): string | null => {
  const custom = customFontId(typeface);
  if (custom) {
    return `${customFamily(custom)}, ${FALLBACK_FACE}`;
  }
  // A typeface that names neither is set in the book serif as well.
  return Object.prototype.hasOwnProperty.call(TYPEFACE_STACK, typeface) ? TYPEFACE_STACK[typeface as BuiltInTypeface] : FALLBACK_FACE;
};

export const readTypeface = (): ReaderTypeface => {
  try {
    const value = localStorage.getItem(TYPEFACE_KEY);
    if (value && isCustomTypeface(value)) {
      return value;
    }
    return value === "book" || value === "modern" || value === "sans" || value === "wide" ? value : "serif";
  } catch {
    return "serif";
  }
};

export type ReaderSpacing = "compact" | "normal" | "airy";

export const SPACING_KEY = "leaflet.reader.spacing";

/** A line's height for each, in lines of the reading size. */
export const LINE_HEIGHT: Record<ReaderSpacing, number> = { compact: 1.5, normal: 1.8, airy: 2.1 };

export const readSpacing = (): ReaderSpacing => {
  try {
    const value = localStorage.getItem(SPACING_KEY);
    return value === "compact" || value === "airy" ? value : "normal";
  } catch {
    return "normal";
  }
};

/**
 * One line of text, in pixels. Everything that counts in lines (Smart Read's
 * page steps, auto-scroll's lines a minute, the words a line holds) asks
 * here: the height was written out as "size x 1.8" in several places, which
 * would all have been wrong at any other spacing.
 */
export const lineHeightPx = (fontSize: number, spacing: ReaderSpacing) => fontSize * LINE_HEIGHT[spacing];

export type ReaderAlign = "justify" | "left";

export const ALIGN_KEY = "leaflet.reader.align";

export const readAlign = (): ReaderAlign => {
  try {
    return localStorage.getItem(ALIGN_KEY) === "left" ? "left" : "justify";
  } catch {
    return "justify";
  }
};

export type TypeChoice = { typeface: ReaderTypeface; spacing: ReaderSpacing; align: ReaderAlign };

/**
 * A type choice as the book's stylesheet reads it: variables on the chapter's
 * root, and two attributes for what a variable cannot switch (imposing a face
 * at all, and turning hyphenation off). "Left" is the start edge, so a book
 * read right to left keeps its ragged edge on the other side.
 */
export const typeVariables = (choice: TypeChoice) => {
  const stack = typefaceStack(choice.typeface);
  return {
    variables: {
      "--reader-font-family": stack ?? FALLBACK_FACE,
      "--reader-line-height": String(LINE_HEIGHT[choice.spacing]),
      "--reader-align": choice.align === "left" ? "start" : "justify"
    } as Record<string, string>,
    attributes: {
      "data-leaflet-face": stack === null ? null : choice.typeface,
      "data-leaflet-align": choice.align
    } as Record<string, string | null>
  };
};

/** Puts a type choice on a chapter's document. */
export const applyTypeChoice = (root: HTMLElement, choice: TypeChoice) => {
  const { variables, attributes } = typeVariables(choice);
  Object.entries(variables).forEach(([name, value]) => root.style.setProperty(name, value));
  Object.entries(attributes).forEach(([name, value]) => {
    if (value === null) {
      root.removeAttribute(name);
    } else {
      root.setAttribute(name, value);
    }
  });
};
