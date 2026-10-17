import { useEffect, useRef } from "react";
import { isTouchInput } from "../../platform/device";
import { dropHeldTap, isQuickTap, isWordDoubleTap, letHeldTapGo, wordAround, type Tap } from "../wordTap";
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
 * By finger, a double tap on a word selects it (readers/wordTap.ts), and the
 * selection's bar comes up as for a press and hold: nothing is highlighted
 * until the bar is used. The first tap's own work, held by the scroll and
 * page taps (useTouchReading.ts, usePageTurning.ts), is dropped. A double tap
 * on a highlight, a name or a link is theirs: the first tap has opened it.
 * A mouse's double-click is the browser's own, as before.
 */
export const useWordDoubleTap = (reader: WithCover) => {
  const { book, layout, loading, renditionRef, viewerRef } = reader;
  const latestRef = useRef(reader);
  latestRef.current = reader;
  useEffect(() => {
    const rendition = renditionRef.current;
    if (loading || !rendition) {
      return undefined;
    }
    let press: (Tap & { touch: boolean }) | null = null;
    let last: (Tap & { doc: Document }) | null = null;
    const down = (event: PointerEvent) => {
      press = event.isPrimary ? { at: performance.now(), x: event.clientX, y: event.clientY, touch: event.pointerType === "touch" } : null;
    };
    const onClick = (event: MouseEvent) => {
      const from = press;
      press = null;
      if (!from?.touch || !isTouchInput() || renditionRef.current !== rendition) {
        return;
      }
      const now = performance.now();
      const doc = (event.target as Node | null)?.ownerDocument ?? null;
      if (!doc || !isQuickTap(now - from.at, Math.hypot(event.clientX - from.x, event.clientY - from.y))) {
        last = null;
        letHeldTapGo(rendition);
        return;
      }
      const tap = { at: now, x: event.clientX, y: event.clientY, doc };
      const first = last && last.doc === doc ? last : null;
      if (!isWordDoubleTap(first, tap)) {
        last = tap;
        letHeldTapGo(rendition);
        return;
      }
      last = null;
      const current = latestRef.current;
      const onto = event.target as Node | null;
      const target = onto?.nodeType === 1 ? (onto as Element) : (onto?.parentElement ?? null);
      const frameBox = doc.defaultView?.frameElement?.getBoundingClientRect();
      const x = event.clientX + (frameBox?.left ?? 0);
      const y = event.clientY + (frameBox?.top ?? 0);
      const viewer = viewerRef.current;
      const onHighlight = viewer ? within(x, y, Array.from(viewer.querySelectorAll(".leaflet-highlight rect"), (mark) => mark.getBoundingClientRect()), 0) : false;
      if (
        current.readingModeRef.current === "speed" ||
        event.defaultPrevented ||
        target?.closest?.(OWN_CLICK) ||
        onHighlight ||
        textAt(doc, event.clientX, event.clientY).name
      ) {
        letHeldTapGo(rendition);
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
        letHeldTapGo(rendition);
        return;
      }
      // The first tap's chrome, page turn or pause is not done; nor is this tap's.
      dropHeldTap(rendition);
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
        // Ahead of the page's taps (the scroll's and the pages' are not capturing), so they find it taken.
        doc.addEventListener("click", onClick, true);
      });
    };
    bind();
    rendition.on?.("rendered", bind);
    return () => {
      rendition.off?.("rendered", bind);
      dropHeldTap(rendition);
      (rendition.getContents?.() ?? []).forEach((contents: any) => {
        const doc = contents?.document as Document | undefined;
        doc?.removeEventListener("pointerdown", down);
        doc?.removeEventListener("click", onClick, true);
      });
    };
  }, [book.id, loading, layout]);
};
