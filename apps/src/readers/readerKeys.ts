/**
 * The text reader's keys: one table, read by the key handler (which action a
 * key press is) and by the shortcuts sheet (what to tell the reader), so the
 * sheet cannot drift from what the keys do.
 *
 * What a key does depends on the layout (scrolling or pages) and the reading
 * mode (standard, Smart Read, SpeedRead); each row says when it applies and
 * how it reads there.
 */

import type { ReaderLayout, ReadingMode } from "./readerTypes";

export type ReaderKeyContext = { layout: ReaderLayout; mode: ReadingMode };

export type ReaderAction =
  | "search"
  | "escape"
  | "back"
  | "forward"
  | "shortcuts"
  | "bookmark"
  | "pageNext"
  | "pagePrev"
  | "chapterNext"
  | "chapterPrev"
  | "faster"
  | "slower"
  | "scrollDown"
  | "scrollUp"
  | "playPause";

/** As much of a keyboard event as the table reads. */
export type KeyPress = {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export type ShortcutGroup = "Reading" | "Moving about" | "Finding and keeping" | "Elsewhere";

type Binding = {
  action: ReaderAction;
  /** The keys as shown on the sheet. */
  keys: string[];
  matches: (press: KeyPress) => boolean;
  /** Where it applies; everywhere when left out. */
  when?: (context: ReaderKeyContext) => boolean;
  /** What it does there, in the reader's words. */
  label: (context: ReaderKeyContext) => string;
  group: ShortcutGroup;
};

const command = (press: KeyPress) => Boolean(press.ctrlKey || press.metaKey);
/** A key on its own: no Ctrl, Cmd or Alt held with it. */
const plain = (press: KeyPress) => !command(press) && !press.altKey;
const isSpace = (press: KeyPress) => press.code === "Space" || press.key === " ";
const scrolling = (context: ReaderKeyContext) => context.layout === "scroll";
const paged = (context: ReaderKeyContext) => context.layout === "pages";

/** In order: the first row that matches a key press, where it applies, is what the press does. */
export const READER_BINDINGS: Binding[] = [
  {
    action: "search",
    keys: ["Ctrl+F"],
    matches: (press) => command(press) && press.key.toLowerCase() === "f",
    label: () => "Search in this book",
    group: "Finding and keeping"
  },
  {
    action: "escape",
    keys: ["Esc"],
    matches: (press) => press.key === "Escape",
    label: () => "Close whatever is open; then let a selection go; then stop what is playing; then leave the book",
    group: "Moving about"
  },
  {
    action: "back",
    keys: ["Alt+←"],
    matches: (press) => Boolean(press.altKey) && press.key === "ArrowLeft",
    label: () => "Back to where you were before a jump",
    group: "Moving about"
  },
  {
    action: "forward",
    keys: ["Alt+→"],
    matches: (press) => Boolean(press.altKey) && press.key === "ArrowRight",
    label: () => "Forward again",
    group: "Moving about"
  },
  {
    action: "shortcuts",
    keys: ["?"],
    matches: (press) => plain(press) && press.key === "?",
    label: () => "Show these keys",
    group: "Finding and keeping"
  },
  {
    action: "bookmark",
    keys: ["B", "Ctrl+D"],
    matches: (press) => (plain(press) && press.key.toLowerCase() === "b") || (command(press) && !press.altKey && press.key.toLowerCase() === "d"),
    label: () => "Bookmark this place",
    group: "Finding and keeping"
  },
  {
    action: "pagePrev",
    keys: ["←", "Page Up", "Shift+Space"],
    matches: (press) => plain(press) && (press.key === "ArrowLeft" || press.key === "PageUp" || (isSpace(press) && Boolean(press.shiftKey))),
    when: paged,
    label: () => "Previous page",
    group: "Moving about"
  },
  {
    action: "pageNext",
    keys: ["→", "Page Down", "Space"],
    matches: (press) => plain(press) && (press.key === "ArrowRight" || press.key === "PageDown" || isSpace(press)),
    when: paged,
    label: () => "Next page",
    group: "Moving about"
  },
  {
    action: "chapterNext",
    keys: ["→"],
    matches: (press) => plain(press) && press.key === "ArrowRight",
    when: scrolling,
    label: () => "Next chapter",
    group: "Moving about"
  },
  {
    action: "chapterPrev",
    keys: ["←"],
    matches: (press) => plain(press) && press.key === "ArrowLeft",
    when: scrolling,
    label: () => "Previous chapter",
    group: "Moving about"
  },
  {
    action: "scrollDown",
    keys: ["↓"],
    matches: (press) => plain(press) && press.key === "ArrowDown",
    when: scrolling,
    label: () => "Scroll down a little",
    group: "Moving about"
  },
  {
    action: "scrollUp",
    keys: ["↑"],
    matches: (press) => plain(press) && press.key === "ArrowUp",
    when: scrolling,
    label: () => "Scroll up a little",
    group: "Moving about"
  },
  {
    action: "playPause",
    keys: ["Space"],
    matches: (press) => plain(press) && isSpace(press),
    when: scrolling,
    label: ({ mode }) =>
      mode === "smart" ? "Pause Smart Read, or carry on" : mode === "speed" ? "Pause SpeedRead, or carry on" : "Start auto-scroll, or pause it",
    group: "Reading"
  },
  {
    action: "faster",
    keys: ["+"],
    matches: (press) => plain(press) && (press.key === "+" || press.key === "="),
    when: scrolling,
    label: ({ mode }) =>
      mode === "smart" ? "Dotty a little faster" : mode === "speed" ? "SpeedRead 20 words a minute faster" : "Auto-scroll faster",
    group: "Reading"
  },
  {
    action: "slower",
    keys: ["-"],
    matches: (press) => plain(press) && (press.key === "-" || press.key === "_"),
    when: scrolling,
    label: ({ mode }) =>
      mode === "smart" ? "Dotty a little slower" : mode === "speed" ? "SpeedRead 20 words a minute slower" : "Auto-scroll slower",
    group: "Reading"
  }
];

/** What a key press does here, or null for a key the reader leaves alone. */
export const actionFor = (press: KeyPress, context: ReaderKeyContext): ReaderAction | null =>
  READER_BINDINGS.find((binding) => binding.matches(press) && (binding.when?.(context) ?? true))?.action ?? null;

export type ShortcutRow = { keys: string[]; label: string };
export type ShortcutSection = { title: string; rows: ShortcutRow[] };

/**
 * Keys that belong to one control and work when it has the keyboard: bound
 * in that control's own component, listed here so the sheet shows them.
 */
const ELSEWHERE: Array<{ keys: string[]; label: string; when?: (context: ReaderKeyContext) => boolean }> = [
  { keys: ["←", "→"], label: "On the progress bar: a hundredth of the book back or on" },
  { keys: ["Page Up", "Page Down"], label: "On the progress bar: a tenth of the book" },
  { keys: ["Home", "End"], label: "On the progress bar: the start or the end" },
  { keys: ["↑", "↓"], label: "On Dotty: move it up or down the page", when: scrolling },
  { keys: ["+", "-", "0"], label: "In a picture: zoom in, zoom out, fit the window" },
  { keys: ["←", "→", "↑", "↓"], label: "In a picture: move it" },
  { keys: ["Tab"], label: "Reach the toolbar, the chapter dock and the progress bar" }
];

const GROUPS: ShortcutGroup[] = ["Reading", "Moving about", "Finding and keeping", "Elsewhere"];

/** The sheet for a layout and a mode: what the reader's keys do right now. */
export const shortcutSections = (context: ReaderKeyContext): ShortcutSection[] => {
  const bound = READER_BINDINGS.filter((binding) => binding.when?.(context) ?? true);
  return GROUPS.map((title) => ({
    title,
    rows:
      title === "Elsewhere"
        ? ELSEWHERE.filter((row) => row.when?.(context) ?? true).map(({ keys, label }) => ({ keys, label }))
        : bound.filter((binding) => binding.group === title).map((binding) => ({ keys: binding.keys, label: binding.label(context) }))
  })).filter((section) => section.rows.length > 0);
};

/**
 * Whether a key press belongs to the control that has the keyboard rather
 * than to the reader: Space and Enter press a focused button, and arrows,
 * Home and End move within a slider, a radio group or a list. Only for a
 * control the keyboard reached (`focusVisible`): a button left focused by a
 * mouse click does not take Space away from reading.
 */
export const keyBelongsToControl = (press: KeyPress, control: { tag: string; role: string; focusVisible: boolean } | null) => {
  if (!control || !control.focusVisible || !plain(press)) {
    return false;
  }
  const tag = control.tag.toLowerCase();
  const pressable = tag === "button" || tag === "a" || tag === "summary" || /^(button|radio|tab|menuitem|option|switch|checkbox|link)$/.test(control.role);
  if (pressable && (isSpace(press) || press.key === "Enter")) {
    return true;
  }
  const steps = /^(slider|radio|tab|option|menuitem)$/.test(control.role);
  return steps && /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(press.key);
};
