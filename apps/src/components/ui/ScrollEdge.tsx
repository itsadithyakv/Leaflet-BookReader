// An edge of a scroller where its content goes out of sight: a ramp of blur and
// tint (<GradualBlur>) held at that edge by a sticky strip of no height, shown
// only while there is more to scroll that way. Put one as the scroller's first
// child (`edge="top"`) and/or its last (`edge="bottom"`). A sticky box stops
// at the scroller's padding, so the strip reads the scroller's padding and
// reaches past it to the very edges (and never past them: a strip wider than
// the scroller would scroll it sideways). Its look is styles/glass.css's.
//
// The blur reads what is painted inside the scroller's nearest backdrop root,
// which is what scrolls under it: so it works inside a sheet or a glass panel.
// The strip carries `hidden` so `space-y-*` spacing passes over it (it is shown
// all the same: styles/glass.css). Not for a scroller whose children are
// spaced by a flex `gap` (the strip would take a gap of its own).

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import GradualBlur, { type GradualBlurProps } from "./GradualBlur";

export type ScrollEdgeProps = Pick<
  GradualBlurProps,
  "height" | "strength" | "layers" | "touchLayers" | "tint" | "curve" | "exponential" | "container"
> & {
  edge?: "top" | "bottom";
  /** "parent": only the element the strip is in, never a scroller further out (a dialog's
      scrolling backdrop): where that does not scroll, the edge stays hidden. */
  scroller?: "nearest" | "parent";
  className?: string;
};

const useIsomorphicLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

/** The surface colour a page fades into: the app's paper. */
export const PAGE_TINT = "rgb(var(--color-background) / 0.78)";
/** Inside a sheet, a dialog or a menu: its glass. */
export const SHEET_TINT = "rgb(var(--color-surface-high) / 0.86)";

export default function ScrollEdge({
  edge = "bottom",
  height = edge === "top" ? "2.5rem" : "3rem",
  strength = 1.25,
  layers = 5,
  touchLayers = 3,
  tint = SHEET_TINT,
  curve = "linear",
  exponential = true,
  container,
  scroller = "nearest",
  className = "",
}: ScrollEdgeProps) {
  const strip = useRef<HTMLDivElement>(null);
  const parent = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return strip.current?.parentElement ?? null;
      }
    }),
    []
  );

  // Out over the scroller's padding to its edges, as that padding changes with the window.
  useIsomorphicLayoutEffect(() => {
    const el = strip.current;
    const box = el?.parentElement;
    if (!el || !box) return undefined;
    const fit = () => {
      const pad = getComputedStyle(box);
      el.style.marginLeft = `-${pad.paddingLeft}`;
      el.style.marginRight = `-${pad.paddingRight}`;
      if (edge === "top") el.style.top = `-${pad.paddingTop}`;
      else el.style.bottom = `-${pad.paddingBottom}`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [edge]);

  return (
    <div ref={strip} className={`scroll-edge scroll-edge-${edge} ${className}`.trim()} aria-hidden="true" hidden>
      <GradualBlur
        position={edge}
        height={height}
        strength={strength}
        layers={layers}
        touchLayers={touchLayers}
        tint={tint}
        curve={curve}
        exponential={exponential}
        container={container ?? (scroller === "parent" ? parent : undefined)}
        autoHide
        duration={0.22}
        zIndex={1}
      />
    </div>
  );
}
