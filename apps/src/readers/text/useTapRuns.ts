import { useEffect, useRef } from "react";
import { isTouchInput } from "../../platform/device";
import { wordAround } from "../wordTap";
import {
  TAP_RUN_MAX, countTap, endTapRun, finishTapRun, glidingAt, isPageTap, markNotTap
} from "../tapRun";
import { OWN_CLICK, textAt, within } from "./usePageTurning";
import type { WithCover } from "./scope";

/** What a block of the page holds as one run of words: the paragraph (or heading, or list item) round a node. */
const blockOf = (node: Node): Element | null => {
  for (let at = node.parentElement; at; at = at.parentElement) {
    const display = at.ownerDocument.defaultView?.getComputedStyle(at).display ?? "block";
    if (!display.startsWith("inline") || at === at.ownerDocument.body) {
      return at;
    }
  }
  return null;
};

/**
 * The word under a point of a chapter's document, as a range: the word's
 * letters only (readers/wordTap.ts, `wordAround`), across the inline pieces
 * it may be split into (a drop cap, a span of italics); null when the point
 * is not on one.
 */
export const wordRangeAt = (doc: Document, x: number, y: number): Range | null => {
  try {
    const caret = (doc as any).caretRangeFromPoint?.(x, y) as Range | null;
    const node = caret?.startContainer;
    const block = node && node.nodeType === 3 ? blockOf(node) : null;
    if (!caret || !node || !block) {
      return null;
    }
    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const pieces: { node: Text; from: number }[] = [];
    let text = "";
    let at = -1;
    for (let piece = walker.nextNode() as Text | null; piece; piece = walker.nextNode() as Text | null) {
      if (piece === node) at = text.length + caret.startOffset;
      pieces.push({ node: piece, from: text.length });
      text += piece.data;
    }
    const found = at >= 0 ? wordAround(text, at) : null;
    if (!found) {
      return null;
    }
    const place = (offset: number, end: boolean) => {
      for (let index = pieces.length - 1; index >= 0; index -= 1) {
        const piece = pieces[index];
        if (end ? piece.from < offset : piece.from <= offset) {
          return { node: piece.node, offset: offset - piece.from };
        }
      }
      return { node: pieces[0].node, offset: 0 };
    };
    const start = place(found.start, false);
    const end = place(found.end, true);
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    // The caret is put at the nearest letter wherever the finger is: only a tap on the word itself picks it.
    return within(x, y, Array.from(range.getClientRects()), 4) ? range : null;
  } catch {
    return null;
  }
};

/**
 * A finger's taps on the page (readers/tapRun.ts). Each click is first told
 * from a scroll: a finger that moved or was held, a page that scrolled while
 * it was down, or one still gliding when it came down (that touch only
 * stopped it), is not a tap, and the page's own taps (useTouchReading.ts,
 * usePageTurning.ts) pass it by. A tap is counted on the run of taps it
 * lands with, and the third on a word selects that word, as a press and hold
 * does: the selection's bar comes up, and nothing is highlighted until the
 * bar is used. Three on a highlight, a name or a link are theirs: the first
 * tap opened it. A mouse's clicks are the browser's own, as before.
 */
export const useTapRuns = (reader: WithCover) => {
  const { book, layout, loading, renditionRef, viewerRef } = reader;
  const latestRef = useRef(reader);
  latestRef.current = reader;
  useEffect(() => {
    const rendition = renditionRef.current;
    if (loading || !rendition) {
      return undefined;
    }
    // When the page last scrolled. With pages it moves only for a turn, which
    // a quick tap at a side makes on purpose: only scrolling is watched.
    const frame = (rendition.manager as any)?.container as HTMLElement | undefined;
    const scroller = layout === "scroll" ? frame : undefined;
    let scrolledAt = Number.NEGATIVE_INFINITY;
    const onScroll = () => {
      scrolledAt = performance.now();
    };
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    let press: { at: number; x: number; y: number; touch: boolean; gliding: boolean } | null = null;
    const down = (event: PointerEvent) => {
      const at = performance.now();
      // A finger on the page stops Smart Read's glide where it is: the page is theirs.
      if (event.pointerType === "touch") {
        latestRef.current.cancelSmartPageTurn();
      }
      press = event.isPrimary
        ? {
            at,
            x: event.clientX,
            y: event.clientY,
            touch: event.pointerType === "touch",
            gliding: glidingAt(at, scrolledAt)
          }
        : null;
    };
    const onClick = (event: MouseEvent) => {
      const from = press;
      press = null;
      if (!from?.touch || !isTouchInput() || renditionRef.current !== rendition) {
        return;
      }
      const now = performance.now();
      const doc = (event.target as Node | null)?.ownerDocument ?? null;
      const tapped = isPageTap({
        moved: Math.hypot(event.clientX - from.x, event.clientY - from.y),
        ms: now - from.at,
        scrolled: scrolledAt > from.at,
        gliding: from.gliding
      });
      if (!doc || !tapped) {
        markNotTap(event);
        finishTapRun(rendition);
        return;
      }
      // In the window's coordinates: the taps of a run may fall in two chapters' frames.
      const frameBox = doc.defaultView?.frameElement?.getBoundingClientRect();
      const x = event.clientX + (frameBox?.left ?? 0);
      const y = event.clientY + (frameBox?.top ?? 0);
      if (countTap(rendition, { at: now, x, y }) < TAP_RUN_MAX) {
        return;
      }
      const current = latestRef.current;
      const onto = event.target as Node | null;
      const target = onto?.nodeType === 1 ? (onto as Element) : (onto?.parentElement ?? null);
      const viewer = viewerRef.current;
      const marks = viewer
        ? Array.from(viewer.querySelectorAll(".leaflet-highlight rect"), (mark) => mark.getBoundingClientRect())
        : [];
      if (
        current.readingModeRef.current === "speed" ||
        event.defaultPrevented ||
        target?.closest?.(OWN_CLICK) ||
        within(x, y, marks, 0) ||
        textAt(doc, event.clientX, event.clientY).name
      ) {
        return;
      }
      const range = wordRangeAt(doc, event.clientX, event.clientY);
      const contents = (rendition.getContents?.() ?? []).find((one: any) => one?.document === doc) as any;
      let cfi: string | null = null;
      try {
        cfi = range && contents?.cfiFromRange ? String(contents.cfiFromRange(range)) : null;
      } catch {
        cfi = null;
      }
      if (!range || !cfi) {
        return;
      }
      // What the first two taps would do (the chrome, a pause) is not done; nor is this tap's.
      endTapRun(rendition);
      event.preventDefault();
      try {
        const picked = doc.defaultView?.getSelection?.();
        picked?.removeAllRanges();
        picked?.addRange(range);
      } catch {
        return;
      }
      // As the book's own "selected" does (useBookOpening.ts), at once: it comes a quarter of a second later, and finds this.
      current.closeNoteRef.current();
      current.setSelection({ cfi, text: range.toString().replace(/\s+/g, " ").trim() });
    };
    const bound = new WeakSet<Document>();
    const bind = () => {
      (rendition.getContents?.() ?? []).forEach((contents: any) => {
        const doc = contents?.document as Document | undefined;
        if (!doc || bound.has(doc)) {
          return;
        }
        bound.add(doc);
        doc.addEventListener("pointerdown", down, { passive: true });
        // Ahead of the page's taps (theirs are not capturing), so they find it told.
        doc.addEventListener("click", onClick, true);
      });
    };
    bind();
    rendition.on?.("rendered", bind);
    return () => {
      rendition.off?.("rendered", bind);
      scroller?.removeEventListener("scroll", onScroll);
      endTapRun(rendition);
      (rendition.getContents?.() ?? []).forEach((contents: any) => {
        const doc = contents?.document as Document | undefined;
        doc?.removeEventListener("pointerdown", down);
        doc?.removeEventListener("click", onClick, true);
      });
    };
  }, [book.id, loading, layout]);
};
