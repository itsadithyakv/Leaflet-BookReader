import { useEffect, useRef } from "react";
import { TAP_SLACK_PX, pressIsClick } from "../pageTurn";
import { isPhoneShape, readLayoutFor, spreadFor, tapAction, tapZone, useTabletSideways, type TapAction } from "../touchLayout";
import { inBookmarkCorner } from "../phoneReading";
import { holdForSecondTap } from "../wordTap";
import { OWN_CLICK, textAt, within } from "./usePageTurning";
import type { Later, WithCover } from "./scope";

/**
 * The text reader by finger (docs/android.md, "The reader"). With pages, the
 * taps are the page's own (usePageInput): the sides turn, the middle brings
 * the chrome. Scrolling has no page to turn, so a plain tap on the text shows
 * the toolbar and the dock, or sends them away: anywhere on a tablet, only in
 * the middle third on a phone (a tap at a side there only sends them away;
 * readers/touchLayout.ts, `tapAction`). One on a link, a note, a name or a
 * highlight is that thing's, and a scroll is reading.
 *
 * While something reads on by itself (docs/mobile.md, "Dotty on a phone") a
 * tap is its pause instead: SpeedRead pauses and carries on, Smart Read and
 * auto-scroll pause (the pace pill's play carries on, and the chrome comes
 * with the next tap).
 */
export const useScrollTaps = (reader: WithCover & Later<"cornerBookmarkRef">) => {
  const { book, hideChrome, interruptedRef, layout, loading, renditionRef, selectionRef, shape, toggleChrome, viewerRef } = reader;
  const chromeRef = useRef({ toggle: toggleChrome, hide: hideChrome, immersive: isPhoneShape(shape) });
  chromeRef.current = { toggle: toggleChrome, hide: hideChrome, immersive: isPhoneShape(shape) };
  const tapRef = useRef((_action: TapAction) => undefined as void);
  tapRef.current = (action: TapAction) => {
    if (reader.readingModeRef.current === "speed") {
      reader.setReadingPaused((paused) => !paused);
      return;
    }
    if (reader.readingModeRef.current === "smart" && !reader.readingPausedRef.current) {
      reader.readingPausedRef.current = true;
      reader.setReadingPaused(true);
      return;
    }
    if (reader.readingModeRef.current === "standard" && reader.autoScrollActiveRef.current) {
      reader.setAutoScrollActive(false);
      return;
    }
    if (action.kind === "bookmark") {
      reader.cornerBookmarkRef.current();
    } else if (action.kind === "chrome") {
      chromeRef.current.toggle();
    } else if (action.kind === "hide") {
      chromeRef.current.hide();
    }
  };
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
      const under = doc !== document ? textAt(doc, event.clientX, event.clientY) : { text: false, name: false };
      const name = under.name;
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
        // The footer's words (a phone): the strip they sit in is the
        // scroller's, so that a swipe from the foot of the page scrolls, and
        // a tap on them comes here (readers/touch.css).
        const footer = viewer?.parentElement?.querySelector<HTMLElement>(".reader-phone-footer");
        const footBox = footer && chromeRef.current.immersive && footer.closest(".reader-chrome-hidden") ? footer.getBoundingClientRect() : null;
        if (footer && footBox && footBox.width > 0 && x >= footBox.left && x <= footBox.right && y >= footBox.top - 4 && y <= footBox.bottom) {
          footer.click();
          return;
        }
        // Which third of the page the tap fell in, measured across the scrolling frame.
        const frame = ((rendition.manager as any)?.container as HTMLElement | undefined)?.getBoundingClientRect();
        const zone = frame ? tapZone(x, frame.left, frame.width) : 0;
        const pageBox = viewer?.parentElement?.getBoundingClientRect();
        const corner = chromeRef.current.immersive && pageBox ? inBookmarkCorner(x, y, pageBox) : false;
        const action = tapAction(zone, "scroll", chromeRef.current.immersive, corner);
        if (!under.text) {
          tapRef.current(action);
          return;
        }
        // On a word it waits a moment: a second tap selects the word instead (useWordDoubleTap.ts).
        holdForSecondTap(rendition, () => {
          if (renditionRef.current === rendition && selectionRef.current === null && !selecting(doc)) {
            tapRef.current(action);
          }
        });
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
 * returns. A tablet keeps one layout, and its pages are a spread on its side.
 * Only a change of layout (or of spread) lays the book out again, round the
 * place; a turn that keeps the layout is a resize, which keeps the reading
 * line by itself (useResizeRelayout).
 */
export const useShapeLayout = (reader: WithCover) => {
  const { relayout, shape } = reader;
  const relayoutRef = useRef(relayout);
  relayoutRef.current = relayout;
  const tabletSideways = useTabletSideways();
  useEffect(() => {
    const next = readLayoutFor(shape);
    relayoutRef.current(next, spreadFor(shape, next));
  }, [shape, tabletSideways]);
};

/** By finger (a phone or a tablet) a selection's bar docks where the chapter dock is: selecting sends the chrome away. */
export const useSelectionHidesChrome = (reader: WithCover) => {
  const { hideChrome, selection, shape } = reader;
  const selecting = selection !== null;
  useEffect(() => {
    if (selecting && shape !== "desktop") {
      hideChrome();
    }
  }, [selecting]);
};
