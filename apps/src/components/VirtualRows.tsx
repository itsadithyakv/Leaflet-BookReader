import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";

/** The app's scrolling area: the library scrolls inside it, not the window. */
const scrollParent = () => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".app-main-scroll"));

/** A layout effect in the page, an effect when drawn to markup (where a layout effect only warns). */
const useIsomorphicLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The rows to draw: those near the screen, and the row holding the keyboard's
 * focus wherever it is. Scrolled out of reach and taken away, a focused card
 * dropped the focus to the page, and the next Tab began again from the top.
 */
export const rowsToDraw = (range: Range, focused: number | null): number[] => {
  const near = defaultRangeExtractor(range);
  if (focused == null || focused >= range.count || near.includes(focused)) {
    return near;
  }
  return [...near, focused].sort((a, b) => a - b);
};

type VirtualRowsProps = {
  /** How many rows. */
  count: number;
  /** A first guess at a row's height, px; each row is measured once drawn. */
  estimate: number;
  /** Space below each row, px (the grid's gap). */
  gap: number;
  /** Rows drawn beyond the visible ones, above and below. */
  overscan?: number;
  renderRow: (index: number) => ReactNode;
};

/**
 * Only the rows near the screen are in the page; the rest are space.
 *
 * A library of a few thousand books used to render every card at once, each
 * asking for its cover. Rows are placed inside the app's own scroll area, so
 * the hero and filters above the list scroll away as before.
 *
 * While the list scrolls, rows are moved by writing their transforms
 * directly (`directDomUpdates`): React draws again only when a row comes into
 * reach or goes out of it, not on every scroll event, so a fling through a
 * long library is a few renders a second rather than one a frame.
 *
 * The first draw starts where the scroll area already is (`initialOffset`),
 * so a page put back at a kept place (the library under a closed book, a tab
 * come back to) draws the rows that are on screen at once, not the top ones
 * and then a blank frame.
 */
export const VirtualRows = ({ count, estimate, gap, overscan = 3, renderRow }: VirtualRowsProps) => {
  const ref = useRef<HTMLDivElement | null>(null);
  // Where the list starts inside the scroll area: the content above it (the
  // hero, the filters) can change height, so it is re-measured when it does.
  const [margin, setMargin] = useState(0);
  useIsomorphicLayoutEffect(() => {
    const scroller = scrollParent();
    const update = () => {
      const element = ref.current;
      if (element && scroller) {
        setMargin(element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
      }
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const content = scroller?.firstElementChild;
    if (observer && content) {
      observer.observe(content);
    }
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // The row the keyboard is in, kept drawn while it is (`rowsToDraw`).
  const focusedRow = useRef<number | null>(null);
  const rangeExtractor = useCallback((range: Range) => rowsToDraw(range, focusedRow.current), []);

  // The scroll area's size for the first draw (measured by the virtualizer from then on).
  const [initialRect] = useState(() => {
    const scroller = scrollParent();
    return scroller ? { width: scroller.clientWidth, height: scroller.clientHeight } : { width: 0, height: 0 };
  });

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: scrollParent,
    estimateSize: () => estimate + gap,
    overscan,
    scrollMargin: margin,
    rangeExtractor,
    initialOffset: () => scrollParent()?.scrollTop ?? 0,
    initialRect,
    directDomUpdates: true,
    // `top`, not a 3D transform: a transform would make every row a layer of its own for the compositor.
    directDomUpdatesMode: "position"
  });

  const setContainer = useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      virtualizer.containerRef(node);
    },
    [virtualizer]
  );

  // Heights and places (`top`) are the virtualizer's to write (`directDomUpdates`):
  // React leaves them alone, so a render between two scroll events cannot put
  // a row back where it was a frame ago.
  return (
    <div
      ref={setContainer}
      style={{ position: "relative" }}
      onFocus={(event) => {
        // (Focus in a card's menu comes here too, through React's portal: it is in no row.)
        const index = Number((event.target as HTMLElement).closest?.("[data-index]")?.getAttribute("data-index") ?? NaN);
        if (Number.isFinite(index)) {
          focusedRow.current = index;
        }
      }}
      onBlur={(event) => {
        // Gone from the list altogether (not just to another card in it).
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          focusedRow.current = null;
        }
      }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            left: 0,
            width: "100%",
            paddingBottom: gap
          }}
        >
          {renderRow(row.index)}
        </div>
      ))}
    </div>
  );
};
