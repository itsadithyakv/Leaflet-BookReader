import { useEffect, useRef } from "react";
import { TAP_SLACK_PX, pressIsClick } from "../pageTurn";
import {
  isPhoneShape, layoutAcrossTurn, runAction, spreadFor, tapAction, tapZone,
  useTabletSideways, type TapAction
} from "../touchLayout";
import { inBookmarkCorner } from "../phoneReading";
import { endTapRun, holdTapRun, isNotTap } from "../tapRun";
import { OWN_CLICK, textAt, within } from "./usePageTurning";
import { raiseReaderVeil, turnSettleNow } from "../readerVeil";
import type { Later, WithCover } from "./scope";

/**
 * The text reader by finger (docs/android.md, "The reader"). With pages, the
 * taps are the page's own (usePageInput): the sides turn, two taps in the
 * middle bring the chrome. Scrolling has no page to turn: two taps anywhere
 * bring the toolbar and the dock, or send them away, and three select the
 * word (readers/tapRun.ts, useTapRuns.ts); one tap at a side of a phone's
 * page only sends them away (readers/touchLayout.ts, `tapAction`,
 * `runAction`). One on a link, a note, a name or a highlight is that
 * thing's, and a scroll (or a touch that stops the page gliding) is reading.
 *
 * While something reads on by itself (docs/mobile.md, "Dotty on a phone") a
 * tap is its pause instead: SpeedRead pauses and carries on, Smart Read and
 * auto-scroll pause (the pace pill's play carries on); two taps pause it and
 * bring the chrome.
 */
export const useScrollTaps = (reader: WithCover & Later<"cornerBookmarkRef">) => {
  const { book, hideChrome, interruptedRef, layout, loading, renditionRef, selectionRef, shape, toggleChrome, viewerRef } = reader;
  const chromeRef = useRef({ toggle: toggleChrome, hide: hideChrome, immersive: isPhoneShape(shape) });
  chromeRef.current = { toggle: toggleChrome, hide: hideChrome, immersive: isPhoneShape(shape) };
  const tapRef = useRef((_single: TapAction, _taps: number) => undefined as void);
  tapRef.current = (single: TapAction, taps: number) => {
    const action = runAction(single, taps);
    if (taps >= 3) {
      return;
    }
    let paused = false;
    if (reader.readingModeRef.current === "speed") {
      reader.setReadingPaused((now) => !now);
      paused = true;
    } else if (reader.readingModeRef.current === "smart" && !reader.readingPausedRef.current) {
      reader.readingPausedRef.current = true;
      reader.setReadingPaused(true);
      paused = true;
    } else if (reader.readingModeRef.current === "standard" && reader.autoScrollActiveRef.current) {
      reader.setAutoScrollActive(false);
      paused = true;
    }
    if (paused && action.kind !== "chrome") {
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
      // (A scroll, a held finger or a touch that stopped the page gliding: useTapRuns.ts.)
      if (!from || isNotTap(event)) {
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
          endTapRun(rendition);
          footer.click();
          return;
        }
        // Which third of the page the tap fell in, measured across the scrolling frame.
        const frame = ((rendition.manager as any)?.container as HTMLElement | undefined)?.getBoundingClientRect();
        const zone = frame ? tapZone(x, frame.left, frame.width) : 0;
        const pageBox = viewer?.parentElement?.getBoundingClientRect();
        const corner = chromeRef.current.immersive && pageBox ? inBookmarkCorner(x, y, pageBox) : false;
        const single = tapAction(zone, "scroll", chromeRef.current.immersive, corner);
        // Done once the run of taps is over: a second may be coming, or a third (useTapRuns.ts).
        holdTapRun(rendition, (taps) => {
          if (renditionRef.current === rendition && selectionRef.current === null && !selecting(doc)) {
            tapRef.current(single, taps);
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
 * A phone (or a tablet) turned: the layout stays the reader's
 * (readers/touchLayout.ts, `layoutAcrossTurn`); pages become a spread of two
 * columns on its side, or one column upright again, and only that lays the
 * book out anew, round the place, under the veil (readers/readerVeil.ts). It
 * waits for the window to keep its size (`TURN_SETTLE_MS`): a turn passes
 * through sizes that are neither way up, and the book was drawn anew for
 * each. A turn that keeps the layout is a resize, laid out once it has
 * settled too (useResizeRelayout).
 */
export const useShapeLayout = (reader: WithCover) => {
  const { relayout, shape } = reader;
  const relayoutRef = useRef(relayout);
  relayoutRef.current = relayout;
  const tabletSideways = useTabletSideways();
  useEffect(() => {
    const layout = layoutAcrossTurn(reader.layoutRef.current);
    if (spreadFor(shape, layout) === reader.spreadRef.current) {
      return undefined;
    }
    raiseReaderVeil(reader.viewerRef.current);
    const timer = window.setTimeout(() => {
      const now = layoutAcrossTurn(reader.layoutRef.current);
      relayoutRef.current(now, spreadFor(shape, now));
    }, turnSettleNow());
    return () => window.clearTimeout(timer);
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
