/**
 * The words of a tooltip, as a finger reads them (TouchTipLayer.tsx): the key
 * hints a keyboard needs ("Close (Esc)", "Search in this book (Ctrl+F)",
 * "Contents (C)") are left out, since a phone has no such keys.
 */

const KEY = String.raw`(?:(?:(?:Ctrl|Alt|Shift|Cmd|Meta|Option)\s*\+\s*)+(?:[A-Za-z0-9]+|[^\s)])|Esc(?:ape)?|Space|Enter|Return|Tab|Backspace|Delete|Del|Home|End|PgUp|PgDn|Page (?:Up|Down)|(?:Left|Right|Up|Down)(?: arrow)?|Arrow ?(?:Left|Right|Up|Down)|[←→↑↓]|F\d{1,2}|[A-Z0]|[+\-=?\/\[\],.])`;
/** Only unmistakable keys after a separator: a letter there may be a word. */
const STRONG_KEY = String.raw`(?:(?:(?:Ctrl|Alt|Shift|Cmd|Meta|Option)\s*\+\s*)+(?:[A-Za-z0-9]+|[^\s)])|Esc(?:ape)?)`;

/** One bracketed hint: "(Esc)", "(Ctrl+Shift+F)", "(+ and - to adjust)", "(Left arrow)". */
const BRACKETED = new RegExp(String.raw`\s*\(${KEY}(?:\s*(?:,|/|or|and)\s*${KEY})*(?:\s+to\s+[a-z ]+)?\)`, "g");
/** A hint after a separator at the end: "Search · Ctrl+F", "Close — Esc". */
const TRAILING = new RegExp(String.raw`\s*[·—–|]\s*${STRONG_KEY}(?:\s*(?:,|/|or)\s*${STRONG_KEY})*\s*$`);

export const stripKeyHints = (text: string): string =>
  text
    .replace(BRACKETED, "")
    .replace(TRAILING, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

/** Where a held finger is the page's own business, not a question about a tooltip. */
export const TIPS_SKIP = [
  // The arcade and the Hollow have their own (components/pip/arcade/base/Tips.tsx).
  ".pip-arcade",
  // Pip on the pages: a hold opens her menu or picks her up.
  ".pip-world",
  // Anything with its own press-and-hold (a book card opens its menu).
  "[data-long-press]",
  "[data-no-touch-tips]",
  // Text that is read and selected: the reader's pages.
  ".textLayer",
  ".reader-page-frame",
  "iframe",
  "input",
  "textarea",
  "select",
  "[contenteditable]"
].join(", ");

/** Things a tap already does something to: only a hold explains these. */
export const PRESSABLE =
  "button, a, input, select, textarea, label, summary, canvas, [role='button'], [role='tab'], [role='link'], [role='menuitem'], [role='menuitemcheckbox'], [role='switch'], [role='checkbox'], [role='radio'], [role='option']";

/** The nearest thing at or above `target` with words to say, unless it is somewhere a hold means something else. */
export const tipHolderOf = (target: EventTarget | null): HTMLElement | null => {
  const from = target instanceof Element ? target : null;
  if (!from || from.closest(TIPS_SKIP)) return null;
  const holder = from.closest<HTMLElement>("[title], [data-tip]");
  if (!holder) return null;
  return tipWordsOf(holder) ? holder : null;
};

export const tipWordsOf = (holder: HTMLElement) =>
  stripKeyHints((holder.getAttribute("title") || holder.dataset.tip || "").trim());
