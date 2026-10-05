/**
 * The page reader's keys: one table, read by the key handler (which action a
 * key press is) and by the shortcuts sheet (what to tell the reader), so the
 * sheet cannot drift from what the keys do. The same pattern as the text
 * reader's (readers/readerKeys.ts).
 *
 * What a key does depends on what is open (a PDF or a comic), the layout
 * (one page at a time, or all the pages in one scroll) and, in a comic, the
 * reading direction; each row says where it applies and how it reads there.
 * The reading keys' own arithmetic (how far to scroll, when to turn) is in
 * readers/pageKeys.ts.
 */

import type { ReadingDirection } from "./pageKeys";

export type PageKeyContext = {
  kind: "pdf" | "comic";
  layout: "pages" | "scroll";
  direction: ReadingDirection;
};

export type PageAction =
  | "search"
  | "goTo"
  | "bookmark"
  | "shortcuts"
  | "back"
  | "forward"
  | "zoomIn"
  | "zoomOut"
  | "fitActual"
  | "fitWidth"
  | "fitPage"
  | "escape"
  | "screenDown"
  | "screenUp"
  | "lineDown"
  | "lineUp"
  | "right"
  | "left"
  | "first"
  | "last";

/**
 * The reading keys: what each does is worked out from where the page is
 * (readers/pageKeys.ts `readingKeyAction`), not from the key alone.
 */
export const READING_ACTIONS: ReadonlySet<PageAction> = new Set<PageAction>([
  "screenDown",
  "screenUp",
  "lineDown",
  "lineUp",
  "right",
  "left",
  "first",
  "last"
]);

/** As much of a keyboard event as the table reads. */
export type KeyPress = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export type PageShortcutGroup = "Reading" | "Moving about" | "Finding and keeping" | "Page size";

type Binding = {
  action: PageAction;
  /** The keys as shown on the sheet. */
  keys: string[];
  matches: (press: KeyPress) => boolean;
  /** Where it applies; everywhere when left out. */
  when?: (context: PageKeyContext) => boolean;
  /** What it does there, in the reader's words. */
  label: (context: PageKeyContext) => string;
  group: PageShortcutGroup;
};

const command = (press: KeyPress) => Boolean(press.ctrlKey || press.metaKey) && !press.altKey;
/** A key on its own: no Ctrl, Cmd or Alt held with it. */
const plain = (press: KeyPress) => !press.ctrlKey && !press.metaKey && !press.altKey;
const letter = (press: KeyPress, wanted: string) => press.key.toLowerCase() === wanted;
const isSpace = (press: KeyPress) => press.key === " " || press.key === "Spacebar";
const scrolling = (context: PageKeyContext) => context.layout === "scroll";
const what = (context: PageKeyContext) => (context.kind === "comic" ? "comic" : "PDF");

/** A turn to the side that goes on, or back, in this reading direction. */
const sideLabel = (side: "left" | "right", context: PageKeyContext) => {
  const on = (side === "right") === (context.direction === "ltr");
  if (scrolling(context)) {
    return on ? "The next page" : "The page before";
  }
  return on
    ? "Next page (a page wider than the window is scrolled across first)"
    : "Previous page (a page wider than the window is scrolled across first)";
};

/** In order: the first row that matches a key press, where it applies, is what the press does. */
export const PAGE_BINDINGS: Binding[] = [
  {
    action: "screenDown",
    keys: ["Space", "Page Down"],
    matches: (press) => plain(press) && ((isSpace(press) && !press.shiftKey) || press.key === "PageDown"),
    label: (context) =>
      scrolling(context) ? "Scroll down a screen" : "Scroll down a screen; at the bottom of the page, the next page",
    group: "Reading"
  },
  {
    action: "screenUp",
    keys: ["Shift+Space", "Page Up"],
    matches: (press) => plain(press) && ((isSpace(press) && Boolean(press.shiftKey)) || press.key === "PageUp"),
    label: (context) =>
      scrolling(context) ? "Scroll up a screen" : "Scroll up a screen; at the top of the page, the end of the page before",
    group: "Reading"
  },
  {
    action: "lineDown",
    keys: ["↓"],
    matches: (press) => plain(press) && press.key === "ArrowDown",
    label: (context) => (scrolling(context) ? "Scroll down a little" : "Scroll down a little; at the bottom, the next page"),
    group: "Reading"
  },
  {
    action: "lineUp",
    keys: ["↑"],
    matches: (press) => plain(press) && press.key === "ArrowUp",
    label: (context) => (scrolling(context) ? "Scroll up a little" : "Scroll up a little; at the top, the page before"),
    group: "Reading"
  },
  {
    action: "right",
    keys: ["→"],
    matches: (press) => plain(press) && press.key === "ArrowRight",
    label: (context) => sideLabel("right", context),
    group: "Moving about"
  },
  {
    action: "left",
    keys: ["←"],
    matches: (press) => plain(press) && press.key === "ArrowLeft",
    label: (context) => sideLabel("left", context),
    group: "Moving about"
  },
  {
    action: "first",
    keys: ["Home"],
    matches: (press) => plain(press) && press.key === "Home",
    label: () => "The first page",
    group: "Moving about"
  },
  {
    action: "last",
    keys: ["End"],
    matches: (press) => plain(press) && press.key === "End",
    label: () => "The last page",
    group: "Moving about"
  },
  {
    action: "goTo",
    keys: ["G", "Ctrl+G"],
    matches: (press) => (plain(press) || command(press)) && letter(press, "g"),
    label: () => "Go to a page: type its number, or how far through (40%)",
    group: "Moving about"
  },
  {
    action: "back",
    keys: ["Alt+←"],
    matches: (press) => Boolean(press.altKey) && !press.ctrlKey && !press.metaKey && press.key === "ArrowLeft",
    label: () => "Back to where you were before a jump (go to, contents, a bookmark, a search result, a link)",
    group: "Moving about"
  },
  {
    action: "forward",
    keys: ["Alt+→"],
    matches: (press) => Boolean(press.altKey) && !press.ctrlKey && !press.metaKey && press.key === "ArrowRight",
    label: () => "Forward again",
    group: "Moving about"
  },
  {
    action: "escape",
    keys: ["Esc"],
    matches: (press) => plain(press) && press.key === "Escape",
    label: (context) => `Close whatever is open; then leave the ${what(context)}`,
    group: "Moving about"
  },
  {
    action: "search",
    keys: ["Ctrl+F"],
    matches: (press) => command(press) && letter(press, "f"),
    // A comic is pictures: there is no text in it to search.
    when: (context) => context.kind === "pdf",
    label: () => "Search in this PDF (Enter and Shift+Enter step through what is found)",
    group: "Finding and keeping"
  },
  {
    action: "bookmark",
    keys: ["B", "Ctrl+D"],
    matches: (press) => (plain(press) && letter(press, "b")) || (command(press) && letter(press, "d")),
    label: (context) =>
      scrolling(context) ? "Bookmark the page you are on, or take its bookmark off" : "Bookmark this page, or take its bookmark off",
    group: "Finding and keeping"
  },
  {
    action: "shortcuts",
    keys: ["?"],
    matches: (press) => plain(press) && press.key === "?",
    label: () => "Show these keys",
    group: "Finding and keeping"
  },
  {
    action: "zoomIn",
    keys: ["+", "Ctrl++"],
    matches: (press) => (plain(press) || command(press)) && (press.key === "+" || press.key === "="),
    label: () => "Larger (Ctrl with the wheel zooms about the pointer)",
    group: "Page size"
  },
  {
    action: "zoomOut",
    keys: ["-", "Ctrl+-"],
    matches: (press) => (plain(press) && press.key === "-") || (command(press) && (press.key === "-" || press.key === "_")),
    label: () => "Smaller",
    group: "Page size"
  },
  {
    action: "fitWidth",
    keys: ["Ctrl+1"],
    matches: (press) => command(press) && press.key === "1",
    label: () => "Fit the page's width to the window",
    group: "Page size"
  },
  {
    action: "fitPage",
    keys: ["Ctrl+2"],
    matches: (press) => command(press) && press.key === "2",
    label: () => "Fit the whole page in the window",
    group: "Page size"
  },
  {
    action: "fitActual",
    keys: ["Ctrl+0"],
    matches: (press) => command(press) && press.key === "0",
    label: () => "Actual size (100%)",
    group: "Page size"
  }
];

/** What a key press does here, or null for a key the page reader leaves alone. */
export const pageActionFor = (press: KeyPress, context: PageKeyContext): PageAction | null =>
  PAGE_BINDINGS.find((binding) => binding.matches(press) && (binding.when?.(context) ?? true))?.action ?? null;

/**
 * Whether a key press is the reader's even while a field is being typed in:
 * the ones held with Ctrl (find, go to, bookmark, zoom). A letter typed in a
 * field is the field's.
 */
export const worksWhileTyping = (press: KeyPress) => command(press);

export type PageShortcutSection = { title: string; rows: Array<{ keys: string[]; label: string }> };

const GROUPS: PageShortcutGroup[] = ["Reading", "Moving about", "Finding and keeping", "Page size"];

/** The sheet for what is open: what the page reader's keys do right now. */
export const pageShortcutSections = (context: PageKeyContext): PageShortcutSection[] => {
  const bound = PAGE_BINDINGS.filter((binding) => binding.when?.(context) ?? true);
  return GROUPS.map((title) => ({
    title,
    rows: bound
      .filter((binding) => binding.group === title)
      .map((binding) => ({ keys: binding.keys, label: binding.label(context) }))
  })).filter((section) => section.rows.length > 0);
};

/** What the sheet says it is describing: "PDF · Scrolling", "Comic · Pages · right to left". */
export const pageShortcutContext = (context: PageKeyContext) =>
  [
    context.kind === "comic" ? "Comic" : "PDF",
    scrolling(context) ? "Scrolling" : "Pages",
    ...(context.direction === "rtl" ? ["right to left"] : [])
  ].join(" · ");
