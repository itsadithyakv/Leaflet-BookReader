import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** The app's scrolling area: the library scrolls inside it, not the window. */
const scrollParent = () => document.querySelector<HTMLElement>(".app-main-scroll");

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
 */
export const VirtualRows = ({ count, estimate, gap, overscan = 3, renderRow }: VirtualRowsProps) => {
  const ref = useRef<HTMLDivElement | null>(null);
  // Where the list starts inside the scroll area: the content above it (the
  // hero, the filters) can change height, so it is re-measured when it does.
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
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

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: scrollParent,
    estimateSize: () => estimate + gap,
    overscan,
    scrollMargin: margin
  });

  return (
    <div ref={ref} style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            paddingBottom: gap,
            transform: `translateY(${row.start - margin}px)`
          }}
        >
          {renderRow(row.index)}
        </div>
      ))}
    </div>
  );
};
