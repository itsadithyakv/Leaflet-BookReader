/**
 * The pointer resting on a name in the book: which name, and where it is on
 * screen, for the peek that says what the book has told of it (`TermPeek`).
 *
 * Nothing is marked in the text and the book's DOM is not touched. A rest of
 * the pointer is looked at once (`DWELL_MS` after it stops), the word under
 * it is found as a click's is in `marks.ts`, and `terms.ts` says whether it
 * is a name at all. Nothing runs while the pointer moves, bar a timer being
 * put back; nothing runs on scroll.
 *
 * A pointer the page moved under is not a pointer resting on a word: the
 * browser reports a move when text scrolls beneath a still mouse (Smart Read
 * turning the page), and those are told apart by the place on the screen not
 * having changed.
 */
import { indexText, offsetOf, rangeOf, type TextIndex } from "./bookText";
import type { Box } from "../lookupPlacement";
import { pointInRects } from "./marks";
import { termsAt, type TermCandidate } from "./terms";

/** How long the pointer rests on a word before it is looked at. */
export const DWELL_MS = 380;
/** How long after the pointer leaves the word the peek stays, for the pointer to reach it. */
export const LEAVE_MS = 260;
/** Around the word, still on it. */
const SLACK = 6;

export type HoverAsk = {
  /** The names the pointer may be on, the longest first. */
  candidates: TermCandidate[];
  /** The name's box in the window. */
  box: Box;
  /** Where it is in the book, when that can be told. */
  cfi: string | null;
  /** The same for the same words in the same chapter. */
  key: string;
};

export type TermHover = {
  /** The chapters now on the page (as `peopleMarks.sync`). */
  sync: (contents: unknown[]) => void;
  /** The pointer is on the peek itself (true), or has left it. */
  keep: (on: boolean) => void;
  /** Whatever is showing goes, now (the page scrolled, a key was pressed). */
  dismiss: () => void;
  clear: () => void;
};

type Options = {
  onAsk: (ask: HoverAsk) => void;
  /** The pointer has left the name (and the peek). */
  onLeave: () => void;
  /** Something else is over the text, or hovering is switched off. */
  blocked?: () => boolean;
  isCommon: (key: string) => boolean;
  /** The fan wiki's page for a word written small, where its pages are known (`terms.ts`: `termsAt`). */
  ownPage?: (key: string) => string | null;
};

type Chapter = {
  doc: Document;
  win: Window & typeof globalThis;
  contents: { cfiFromRange?: (range: Range) => string };
  index: TextIndex | null;
  unbind: () => void;
};

export const termHover = ({ onAsk, onLeave, blocked, isCommon, ownPage }: Options): TermHover => {
  const chapters = new Map<Document, Chapter>();
  let dwell: number | null = null;
  let leaving: number | null = null;
  /** What is showing: its chapter, its key, and the name's rectangles there. */
  let shown: { chapter: Chapter; key: string; range: Range } | null = null;
  let kept = false;
  let lastScreen: { x: number; y: number } | null = null;

  const stopDwell = () => {
    if (dwell !== null) {
      window.clearTimeout(dwell);
      dwell = null;
    }
  };
  const stopLeaving = () => {
    if (leaving !== null) {
      window.clearTimeout(leaving);
      leaving = null;
    }
  };
  const leaveNow = () => {
    stopLeaving();
    if (shown) {
      shown = null;
      onLeave();
    }
  };
  const leaveSoon = () => {
    if (!shown || leaving !== null || kept) {
      return;
    }
    leaving = window.setTimeout(() => {
      leaving = null;
      if (!kept) {
        leaveNow();
      }
    }, LEAVE_MS);
  };

  const rectsOf = (range: Range) => {
    try {
      return Array.from(range.getClientRects());
    } catch {
      return [];
    }
  };

  /** What the pointer, resting at a point of a chapter, is on. */
  const look = (chapter: Chapter, x: number, y: number) => {
    if (!chapters.has(chapter.doc) || blocked?.()) {
      return;
    }
    try {
      const picked = chapter.win.getSelection();
      if (picked && !picked.isCollapsed && picked.toString().trim()) {
        return;
      }
    } catch {
      // No selection to speak of.
    }
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
    if (!node || node.nodeType !== 3 || !doc.body) {
      return;
    }
    // The chapter's text, read once; again if the page was laid out afresh under it.
    let index = chapter.index;
    let at = index ? offsetOf(index, node, offset) : null;
    if (!index || at === null || !index.nodes.includes(node as Text)) {
      index = indexText(doc.body);
      chapter.index = index;
      at = offsetOf(index, node, offset);
    }
    if (at === null) {
      return;
    }
    const candidates = termsAt(index.text, at, isCommon, ownPage);
    if (candidates.length === 0) {
      return;
    }
    const whole = candidates[0];
    const range = rangeOf(index, whole.start, whole.end);
    if (!range) {
      return;
    }
    // A caret snaps to the nearest text from far away: the pointer must be on the words.
    const rects = rectsOf(range);
    const under = rects.find((rect) => pointInRects(x, y, [rect], 2));
    if (!under) {
      return;
    }
    const key = `${whole.start}:${whole.end}:${whole.text}`;
    if (shown && shown.chapter === chapter && shown.key === key) {
      stopLeaving();
      return;
    }
    const frame = (chapter.win.frameElement as HTMLElement | null)?.getBoundingClientRect();
    if (!frame) {
      return;
    }
    let cfi: string | null = null;
    try {
      cfi = chapter.contents.cfiFromRange?.(range) ?? null;
    } catch {
      cfi = null;
    }
    stopLeaving();
    shown = { chapter, key, range };
    onAsk({
      candidates,
      box: { left: frame.left + under.left, right: frame.left + under.right, top: frame.top + under.top, bottom: frame.top + under.bottom },
      cfi,
      key
    });
  };

  const attach = (contents: Chapter["contents"] & { document?: Document; window?: Window }) => {
    const doc = contents?.document;
    const win = (contents?.window ?? doc?.defaultView) as (Window & typeof globalThis) | null | undefined;
    if (!doc || !win || chapters.has(doc)) {
      return;
    }
    const chapter: Chapter = { doc, win, contents, index: null, unbind: () => undefined };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") {
        return;
      }
      // The page moved, not the hand.
      if (lastScreen && lastScreen.x === event.screenX && lastScreen.y === event.screenY) {
        return;
      }
      lastScreen = { x: event.screenX, y: event.screenY };
      stopDwell();
      if (event.buttons !== 0) {
        return;
      }
      const x = event.clientX;
      const y = event.clientY;
      if (shown) {
        const on = shown.chapter === chapter && pointInRects(x, y, rectsOf(shown.range), SLACK);
        if (on) {
          stopLeaving();
          return;
        }
        leaveSoon();
      }
      dwell = window.setTimeout(() => {
        dwell = null;
        look(chapter, x, y);
      }, DWELL_MS);
    };
    const onOut = (event: MouseEvent) => {
      // Out of the chapter's frame altogether (onto the peek, or off the page).
      if (!event.relatedTarget) {
        stopDwell();
        leaveSoon();
      }
    };
    const onAct = () => {
      stopDwell();
      leaveNow();
    };
    doc.addEventListener("pointermove", onMove, { passive: true });
    doc.addEventListener("mouseout", onOut, { passive: true });
    doc.addEventListener("pointerdown", onAct, { passive: true });
    doc.addEventListener("keydown", onAct, { passive: true });
    doc.addEventListener("wheel", onAct, { passive: true });
    chapter.unbind = () => {
      doc.removeEventListener("pointermove", onMove);
      doc.removeEventListener("mouseout", onOut);
      doc.removeEventListener("pointerdown", onAct);
      doc.removeEventListener("keydown", onAct);
      doc.removeEventListener("wheel", onAct);
    };
    chapters.set(doc, chapter);
  };

  const detach = (chapter: Chapter) => {
    try {
      chapter.unbind();
    } catch {
      // The document has gone, and its listeners with it.
    }
    if (shown?.chapter === chapter) {
      leaveNow();
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
    keep: (on) => {
      kept = on;
      if (on) {
        stopLeaving();
      } else {
        leaveSoon();
      }
    },
    dismiss: () => {
      stopDwell();
      kept = false;
      leaveNow();
    },
    clear: () => {
      stopDwell();
      kept = false;
      leaveNow();
      [...chapters.values()].forEach(detach);
    }
  };
};
