import { useEffect, useRef } from "react";
import { TAP_SLACK_PX, pressIsClick } from "../pageTurn";
import { isPhoneShape, readLayoutFor, spreadFor } from "../touchLayout";
import { OWN_CLICK, textAt, within } from "./usePageTurning";
import type { WithCover } from "./scope";

/**
 * The text reader by finger (docs/android.md, "The reader"). With pages, the
 * taps are the page's own (usePageInput): the sides turn, the middle brings
 * the chrome. Scrolling has no page to turn, so a plain tap anywhere on the
 * text shows the toolbar and the dock, or sends them away; one on a link, a
 * note, a name or a highlight is that thing's, and a scroll is reading.
 */
export const useScrollTaps = (reader: WithCover) => {
  const { book, interruptedRef, layout, loading, renditionRef, selectionRef, toggleChrome, viewerRef } = reader;
  const toggleRef = useRef(toggleChrome);
  toggleRef.current = toggleChrome;
  useEffect(() => {
    const rendition = renditionRef.current;
    if (loading || layout !== "scroll" || !rendition) {
      return undefined;
    }
    let press: { x: number; y: number; at: number; selection: boolean } | null = null;
    const selecting = (doc: Document | null | undefined) => {
      try {
        const picked = doc?.defaultView?.getSelection?.();
        return Boolean(picked && !picked.isCollapsed && picked.toString().trim());
      } catch {
        return false;
      }
    };
    const down = (event: PointerEvent) => {
      press =
        event.pointerType === "touch" && event.isPrimary
          ? { x: event.clientX, y: event.clientY, at: performance.now(), selection: selectionRef.current !== null || selecting((event.target as Node | null)?.ownerDocument) }
          : null;
    };
    const onClick = (event: MouseEvent) => {
      const from = press;
      press = null;
      if (!from) {
        return;
      }
      const onto = event.target as Node | null;
      const target = onto?.nodeType === 1 ? (onto as Element) : (onto?.parentElement ?? null);
      const doc = onto?.ownerDocument ?? null;
      if (!doc || renditionRef.current !== rendition) {
        return;
      }
      const held = doc.defaultView?.frameElement?.getBoundingClientRect() ?? null;
      const x = event.clientX + (held?.left ?? 0);
      const y = event.clientY + (held?.top ?? 0);
      const viewer = viewerRef.current;
      const name = doc !== document && textAt(doc, event.clientX, event.clientY).name;
      const highlight = viewer ? within(x, y, Array.from(viewer.querySelectorAll(".leaflet-highlight rect"), (mark) => mark.getBoundingClientRect()), 0) : false;
      const plain = pressIsClick({
        button: event.button,
        modified: false,
        moved: Math.hypot(event.clientX - from.x, event.clientY - from.y),
        ms: performance.now() - from.at,
        count: 1,
        selection: from.selection || selectionRef.current !== null || selecting(doc),
        covered: interruptedRef.current,
        claimed: event.defaultPrevented || Boolean(target?.closest?.(OWN_CLICK)) || name || highlight,
        slack: TAP_SLACK_PX
      });
      if (plain) {
        toggleRef.current();
      }
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
        doc.addEventListener("click", onClick);
      });
    };
    bind();
    rendition.on?.("rendered", bind);
    return () => {
      rendition.off?.("rendered", bind);
      (rendition.getContents?.() ?? []).forEach((contents: any) => {
        const doc = contents?.document as Document | undefined;
        doc?.removeEventListener("pointerdown", down);
        doc?.removeEventListener("click", onClick);
      });
    };
  }, [book.id, loading, layout]);
};

/**
 * A phone turned: the layout kept for this way up (readers/touchLayout.ts).
 * Sideways defaults to pages as a spread; turned back, the upright choice
 * returns. Only a change of layout (or of spread) lays the book out again,
 * round the place; a turn that keeps the layout is a resize, which keeps the
 * reading line by itself (useResizeRelayout).
 */
export const useShapeLayout = (reader: WithCover) => {
  const { relayout, shape } = reader;
  const relayoutRef = useRef(relayout);
  relayoutRef.current = relayout;
  useEffect(() => {
    const next = readLayoutFor(shape);
    relayoutRef.current(next, spreadFor(shape, next));
  }, [shape]);
};

/** On a phone a selection's bar docks where the chapter dock is: selecting sends the chrome away. */
export const useSelectionHidesChrome = (reader: WithCover) => {
  const { hideChrome, selection, shape } = reader;
  const selecting = selection !== null;
  useEffect(() => {
    if (selecting && isPhoneShape(shape)) {
      hideChrome();
    }
  }, [selecting]);
};
