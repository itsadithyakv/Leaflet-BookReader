import { useEffect, useState } from "react";
import GradualBlur from "../../components/ui/GradualBlur";
import { pageEdges } from "../scrollEdges";
import { isPhoneShape } from "../touchLayout";
import { useTouchInput } from "../../platform/device";
import type { ReaderScope } from "./scope";

/**
 * The page's scroll edges (readers/scrollEdges.ts): where the text scrolls
 * out under the toolbar, the dock and the window's edges it goes soft. In the
 * page's frame, over the book and under everything else there; none of it
 * takes a pointer, and nothing in the book is laid out anew for it.
 */
export const ReaderEdges = ({ reader }: { reader: ReaderScope }) => {
  const { autoScrollActive, loading, paged, readingMode, readingPaused, shape } = reader;
  const touch = useTouchInput();
  // The scroller is epub.js's (`rendition.manager.container`), there once the book is.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setScroller(paged || loading ? null : (reader.ensureScrollContainer() ?? null));
  }, [paged, loading]);
  const moving =
    (readingMode === "smart" && !readingPaused) ||
    (readingMode === "standard" && autoScrollActive) ||
    // Paused, the text stands still: the ramps get their blur back.
    reader.readAloud?.status === "playing";
  const ramps = pageEdges({ paged, speed: readingMode === "speed", phone: isPhoneShape(shape), touch, moving });
  if (!scroller || !scroller.isConnected || ramps.length === 0) return null;
  return (
    <>
      {ramps.map((ramp) => (
        <GradualBlur
          key={ramp.edge}
          {...ramp.props}
          container={scroller}
          className={`reader-edge reader-edge-${ramp.edge} ${ramp.tintOnly ? "is-tint-only" : ""}`}
        />
      ))}
    </>
  );
};
