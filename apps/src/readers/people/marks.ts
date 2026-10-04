/**
 * Known names, marked in the chapters on screen with a quiet dotted
 * underline, and a click on one.
 *
 * The book's DOM is not touched: the reader numbers its text nodes (Smart
 * Read, Dotty), and wrapping a word in an element would renumber them. The
 * underline is drawn with the CSS Custom Highlight API (ranges registered in
 * `CSS.highlights`, styled by a `::highlight()` rule in an adopted
 * stylesheet), and a click is matched against those ranges. Where the API is
 * missing there are no underlines, and "Who is this?" on a selection still
 * works.
 *
 * Chapters come and go as the page scrolls. Each one's ranges and listeners
 * are held under its document and dropped when it leaves; a chapter is
 * searched once, when the page is idle, and again only when the names known
 * at this place change. Nothing here runs on scroll.
 */
import { indexText, rangeOf } from "./bookText";
import { nameMatcher, type NameEntry } from "./names";

/** The highlight's name in each chapter's own registry. */
export const MARK_NAME = "leaflet-people";
/** More marks than this in one chapter and the rest go unmarked (their names can still be selected). */
export const MAX_MARKS = 2500;
/** A press that moved further than this before letting go was a drag, not a click. */
const DRAG_SLACK = 5;
/** A click waits this long before it opens a card, so the first click of a double-click (selecting the word) does not. */
const DOUBLE_CLICK_MS = 220;

const MARK_CSS = `::highlight(${MARK_NAME}) {
  text-decoration: underline dotted;
  text-decoration-color: color-mix(in srgb, currentColor 55%, transparent);
  text-decoration-thickness: from-font;
  text-underline-offset: 0.2em;
}`;

/** What is known about a click, for deciding whether it asks who a name is. */
export type ClickFacts = {
  button: number;
  modified: boolean;
  /** Something else already took the click (a footnote popup, a web link). */
  handled: boolean;
  /** It was on a link, a note reference or a control. */
  onLink: boolean;
  /** Text is selected in the chapter. */
  selecting: boolean;
  /** How far the pointer moved between pressing and letting go. */
  moved: number;
};

/**
 * A plain click, on plain text, with nothing selected: only that opens a
 * card. Selecting text, following a link or a footnote, and anything another
 * handler has claimed are left exactly as they were.
 */
export const clickAsks = (facts: ClickFacts) =>
  facts.button === 0 && !facts.modified && !facts.handled && !facts.onLink && !facts.selecting && facts.moved <= DRAG_SLACK;

type Rect = { left: number; right: number; top: number; bottom: number };

/** Whether a point is on the words themselves (a caret snaps to the nearest text from far away). */
export const pointInRects = (x: number, y: number, rects: Rect[], slack = 2) =>
  rects.some((rect) => x >= rect.left - slack && x <= rect.right + slack && y >= rect.top - slack && y <= rect.bottom + slack);

/**
 * Links, note references and controls: a click on one is theirs. An anchor
 * with no `href` is only a place to jump to (some books wrap every paragraph
 * in one), and is plain text to a click.
 */
const LINKS = "a[href], area[href], [role='link'], [role='doc-noteref'], button, input, textarea, select, label, summary, audio, video";

type Mark = { range: Range; person: string };

type Chapter = {
  doc: Document;
  win: Window & typeof globalThis;
  /** The epub.js contents, for the place of a clicked name. */
  contents: { cfiFromRange?: (range: Range) => string };
  marks: Mark[];
  /** The names its marks were made from; null until it has been searched. */
  marked: string | null;
  pending: number | null;
  sheet: CSSStyleSheet | null;
  style: HTMLStyleElement | null;
  pressed: { x: number; y: number } | null;
  /** A click waiting to open a card. */
  opening: number | null;
  unbind: () => void;
};

export type PeopleMarks = {
  /** The chapters now on the page (epub.js `rendition.getContents()`): new ones are taken on, gone ones dropped. */
  sync: (contents: unknown[]) => void;
  /** The names known at the place being read. An unchanged list does nothing. */
  setNames: (names: NameEntry[]) => void;
  /** Lets every chapter go. */
  clear: () => void;
  /** How many chapters are held, and marks in them (for tests). */
  size: () => { chapters: number; marks: number };
};

type Options = {
  /** A name was clicked: whose it is, and where it is in the book. */
  onOpen: (person: string, cfi: string | null) => void;
  /** Something else is over the text: a click there is not for this. */
  blocked?: () => boolean;
};

const idle = (run: () => void): number => {
  const later = (window as unknown as { requestIdleCallback?: (cb: () => void, options: { timeout: number }) => number })
    .requestIdleCallback;
  return later ? later(run, { timeout: 1200 }) : window.setTimeout(run, 80);
};
const cancelIdle = (handle: number) => {
  const cancel = (window as unknown as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
  if (cancel) {
    cancel(handle);
  } else {
    window.clearTimeout(handle);
  }
};

const supported = (win: Window | null | undefined) => {
  try {
    const view = win as unknown as { CSS?: { highlights?: unknown }; Highlight?: unknown } | null;
    return Boolean(view?.CSS?.highlights) && typeof view?.Highlight === "function";
  } catch {
    return false;
  }
};

export const peopleMarks = ({ onOpen, blocked }: Options): PeopleMarks => {
  const chapters = new Map<Document, Chapter>();
  let names: NameEntry[] = [];
  let namesKey = "";
  let find = nameMatcher([]);

  const registry = (chapter: Chapter) =>
    (chapter.win as unknown as { CSS: { highlights: Map<string, unknown> } }).CSS.highlights;

  const unmark = (chapter: Chapter) => {
    chapter.marks = [];
    try {
      registry(chapter).delete(MARK_NAME);
    } catch {
      // The frame has gone; so have its highlights.
    }
  };

  const search = (chapter: Chapter) => {
    chapter.pending = null;
    if (!chapters.has(chapter.doc) || chapter.marked === namesKey) {
      return;
    }
    unmark(chapter);
    chapter.marked = namesKey;
    const body = chapter.doc.body;
    if (names.length === 0 || !body) {
      return;
    }
    try {
      const index = indexText(body);
      const marks: Mark[] = [];
      for (const hit of find(index.text, MAX_MARKS)) {
        const range = rangeOf(index, hit.start, hit.end);
        if (range) {
          marks.push({ range, person: hit.person });
        }
      }
      if (marks.length === 0) {
        return;
      }
      const Highlight = (chapter.win as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;
      registry(chapter).set(MARK_NAME, new Highlight(...marks.map((mark) => mark.range)));
      chapter.marks = marks;
    } catch {
      // A chapter that cannot be marked is read unmarked.
      unmark(chapter);
    }
  };

  const schedule = (chapter: Chapter) => {
    if (chapter.pending === null && chapter.marked !== namesKey) {
      chapter.pending = idle(() => search(chapter));
    }
  };

  /** The mark under a point of the chapter, if the point is on its words. */
  const markAt = (chapter: Chapter, x: number, y: number): Mark | null => {
    const doc = chapter.doc as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let node: Node | null = null;
    let offset = 0;
    const caret = doc.caretRangeFromPoint?.(x, y);
    if (caret) {
      node = caret.startContainer;
      offset = caret.startOffset;
    } else {
      const position = doc.caretPositionFromPoint?.(x, y);
      node = position?.offsetNode ?? null;
      offset = position?.offset ?? 0;
    }
    if (!node) {
      return null;
    }
    for (const mark of chapter.marks) {
      try {
        if (mark.range.isPointInRange(node, offset) && pointInRects(x, y, Array.from(mark.range.getClientRects()))) {
          return mark;
        }
      } catch {
        // A range whose text has gone is no longer a name.
      }
    }
    return null;
  };

  const attach = (contents: Chapter["contents"] & { document?: Document; window?: Window }) => {
    const doc = contents?.document;
    const win = (contents?.window ?? doc?.defaultView) as (Window & typeof globalThis) | null | undefined;
    if (!doc || !win || chapters.has(doc) || !supported(win)) {
      return;
    }
    const chapter: Chapter = {
      doc,
      win,
      contents,
      marks: [],
      marked: null,
      pending: null,
      sheet: null,
      style: null,
      pressed: null,
      opening: null,
      unbind: () => undefined
    };
    // The rule that draws the underline. An adopted stylesheet adds no node to
    // the book's document; a style element in its head is the fallback.
    try {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(MARK_CSS);
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      chapter.sheet = sheet;
    } catch {
      try {
        const style = doc.createElement("style");
        style.textContent = MARK_CSS;
        doc.head?.appendChild(style);
        chapter.style = style;
      } catch {
        return;
      }
    }

    const onDown = (event: PointerEvent) => {
      chapter.pressed = { x: event.clientX, y: event.clientY };
      // A second press: a double-click, or the start of a selection.
      if (chapter.opening !== null) {
        window.clearTimeout(chapter.opening);
        chapter.opening = null;
      }
    };
    const onClick = (event: MouseEvent) => {
      const pressed = chapter.pressed;
      chapter.pressed = null;
      if (chapter.marks.length === 0 || blocked?.()) {
        return;
      }
      const target = event.target as Element | null;
      const moved = pressed ? Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) : 0;
      let selecting = false;
      try {
        const picked = win.getSelection();
        selecting = Boolean(picked && !picked.isCollapsed && picked.toString().trim());
      } catch {
        selecting = false;
      }
      const asks = clickAsks({
        button: event.button,
        modified: event.ctrlKey || event.metaKey || event.shiftKey || event.altKey,
        handled: event.defaultPrevented,
        onLink: Boolean(target?.closest?.(LINKS)),
        selecting,
        moved
      });
      if (!asks) {
        return;
      }
      const mark = markAt(chapter, event.clientX, event.clientY);
      if (!mark) {
        return;
      }
      let cfi: string | null = null;
      try {
        cfi = chapter.contents.cfiFromRange?.(mark.range) ?? null;
      } catch {
        cfi = null;
      }
      // Nothing is prevented: whatever a click on the page did before, it still does.
      const person = mark.person;
      chapter.opening = window.setTimeout(() => {
        chapter.opening = null;
        if (chapters.has(doc) && !blocked?.()) {
          onOpen(person, cfi);
        }
      }, DOUBLE_CLICK_MS);
    };
    doc.addEventListener("pointerdown", onDown, { passive: true });
    // After the reader's own handlers and the book's links (which run first, capturing).
    doc.addEventListener("click", onClick);
    chapter.unbind = () => {
      doc.removeEventListener("pointerdown", onDown);
      doc.removeEventListener("click", onClick);
    };
    chapters.set(doc, chapter);
    schedule(chapter);
  };

  const detach = (chapter: Chapter) => {
    if (chapter.pending !== null) {
      cancelIdle(chapter.pending);
      chapter.pending = null;
    }
    if (chapter.opening !== null) {
      window.clearTimeout(chapter.opening);
      chapter.opening = null;
    }
    try {
      chapter.unbind();
    } catch {
      // The document has gone, and its listeners with it.
    }
    unmark(chapter);
    try {
      if (chapter.sheet) {
        chapter.doc.adoptedStyleSheets = chapter.doc.adoptedStyleSheets.filter((sheet) => sheet !== chapter.sheet);
      }
      chapter.style?.remove();
    } catch {
      // Likewise.
    }
    chapters.delete(chapter.doc);
  };

  return {
    sync: (contents) => {
      const live = new Set<Document>();
      for (const item of Array.isArray(contents) ? contents : []) {
        const doc = (item as { document?: Document } | null)?.document;
        if (doc) {
          live.add(doc);
          attach(item as Chapter["contents"]);
        }
      }
      for (const chapter of [...chapters.values()]) {
        if (!live.has(chapter.doc)) {
          detach(chapter);
        }
      }
    },
    setNames: (next) => {
      const key = next.map((name) => `${name.exact ? "=" : "~"}${name.text}>${name.person}`).join("|");
      if (key === namesKey) {
        return;
      }
      names = next;
      namesKey = key;
      find = nameMatcher(next);
      chapters.forEach(schedule);
    },
    clear: () => {
      [...chapters.values()].forEach(detach);
    },
    size: () => ({
      chapters: chapters.size,
      marks: [...chapters.values()].reduce((sum, chapter) => sum + chapter.marks.length, 0)
    })
  };
};
