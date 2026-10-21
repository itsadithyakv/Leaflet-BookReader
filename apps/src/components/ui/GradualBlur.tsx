// After React Bits' <GradualBlur /> (by Ansh, github.com/ansh-dhanani), ported to
// TypeScript and fitted to Leaflet: a soft ramp of blur where content scrolls
// under a bar or out of a panel, instead of a hard edge.
//
// Fitted how:
// - The stack is a function (blurStack) so it can be tested, and a phone gets
//   fewer layers (each is a backdrop-filter drawn every frame while scrolling).
// - Where no blur is drawn (`.no-glass`, reduced transparency, no support) the
//   tint wash alone fades the edge (gradualBlur.css).
// - autoHide looks for the scroller as the original does, and also follows
//   one that appears later (a list that mounts after the overlay).
// - Below the full visual effects (Smooth, minimal: platform/perfTier.ts) no
//   blur layer is drawn at all: the tint wash alone fades the edge.

import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type RefObject } from "react";
import { usePerfTier } from "../../platform/perfTier";
import "./gradualBlur.css";

export type BlurEdge = "top" | "bottom" | "left" | "right";
export type BlurCurve = "linear" | "bezier" | "ease-in" | "ease-out" | "ease-in-out";

const CURVES: Record<BlurCurve, (t: number) => number> = {
  linear: (t) => t,
  bezier: (t) => t * t * (3 - 2 * t),
  "ease-in": (t) => t * t,
  "ease-out": (t) => 1 - (1 - t) * (1 - t),
  "ease-in-out": (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

const DIRECTIONS: Record<BlurEdge, string> = { top: "to top", bottom: "to bottom", left: "to left", right: "to right" };

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
const toLength = (value: string | number) => (typeof value === "number" ? `${value}px` : value);
const toTime = (value: string | number) => (typeof value === "number" ? `${value}s` : value);

/** A finger's device draws every layer on every scrolled frame: it gets at most this many. */
export const TOUCH_LAYERS = 5;

export type BlurStackOptions = {
  edge: BlurEdge;
  layers: number;
  curve: BlurCurve;
  strength: number;
  exponential: boolean;
  saturation: number;
  opacity: number;
  tint: string;
  duration: number | string;
  easing: string;
};

/** The layers' styles: each blurs a little more than the one before, masked to its slice of the ramp. */
export const blurStack = (o: BlurStackOptions) => {
  const count = Math.min(Math.max(Math.round(o.layers) || 1, 1), 16);
  const shape = CURVES[o.curve] ?? CURVES.linear;
  const maxBlur = Math.max(o.strength, 0) * 12;
  const level = (u: number) => {
    const t = shape(clamp01(u));
    return maxBlur * (o.exponential ? (Math.pow(2, 4 * t) - 1) / 15 : t);
  };
  const boost = Math.pow(Math.max(o.saturation, 0), 1 / count);
  const fade = `${toTime(o.duration)} ${o.easing}`;
  const direction = DIRECTIONS[o.edge];
  const steps: CSSProperties[] = [];
  for (let i = 0; i < count; i++) {
    const from = level(i / count);
    const to = level((i + 1) / count);
    // Stacked blurs add as squares: this layer adds what takes the one below it to `to`.
    const radius = Math.sqrt(Math.max(to * to - from * from, 0));
    // The blur itself never changes as the edge comes and goes (a backdrop-filter is not
    // animated: styles/glass.css); the layer's opacity does, which costs nothing more.
    const filter = [
      `blur(calc(${radius.toFixed(3)}px * var(--gradual-blur-hover, 1)))`,
      boost !== 1 ? `saturate(${boost.toFixed(4)})` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const mask = `linear-gradient(${direction}, transparent ${((i / count) * 100).toFixed(2)}%, #000 ${(((i + 1) / count) * 100).toFixed(2)}%)`;
    steps.push({
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      backdropFilter: filter,
      WebkitBackdropFilter: filter,
      maskImage: mask,
      WebkitMaskImage: mask,
      opacity: `calc(${clamp01(o.opacity)} * var(--gradual-blur-reveal, 1))` as unknown as number,
      transition: `opacity ${fade}`,
    });
  }
  const stops = Array.from({ length: 9 }, (_, k) => {
    const u = k / 8;
    const t = shape(u);
    const alpha = t * t * t * (t * (t * 6 - 15) + 10);
    return `rgba(0, 0, 0, ${alpha.toFixed(3)}) ${(u * 100).toFixed(1)}%`;
  }).join(", ");
  const tintMask = `linear-gradient(${direction}, ${stops})`;
  const wash: CSSProperties | null =
    o.tint && o.tint !== "transparent"
      ? {
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          background: o.tint,
          maskImage: tintMask,
          WebkitMaskImage: tintMask,
          opacity: "calc(var(--gradual-blur-reveal, 1) * min(var(--gradual-blur-hover, 1), 1))" as unknown as number,
          transition: `opacity ${fade}`,
        }
      : null;
  return { steps, wash };
};

type ScrollerRef = string | HTMLElement | RefObject<HTMLElement | null>;

type Node = { parentElement: Node | null; children: ArrayLike<unknown> };

/**
 * The scroller an edge watches: a sibling that scrolls (an overlay laid over a list, as in
 * React Bits), else the nearest ancestor that does (an edge held in a sticky strip inside it).
 */
export const nearestScroller = <T extends Node>(root: T, scrolls: (node: T) => boolean, stop?: T | null): T | null => {
  const parent = root.parentElement as T | null;
  if (!parent) return null;
  const sibling = Array.from(parent.children as ArrayLike<T>).find((child) => child !== root && scrolls(child));
  if (sibling) return sibling;
  for (let node: T | null = parent; node && node !== stop; node = node.parentElement as T | null) {
    if (scrolls(node)) return node;
  }
  return null;
};

type Rows = { forEach: (each: (node: { nodeType: number }) => void) => void };
type Watcher = { observe: (target: never) => void; unobserve: (target: never) => void };

/**
 * A scroller's rows as they come and go, for the observer of their sizes: a new one is watched, and one taken away
 * is let go. (Watched, a row taken away was kept alive by the observer: on the app's own scroller, the whole of each
 * page left for another tab.)
 */
export const followRows = (observer: Watcher | null, changes: ArrayLike<{ addedNodes: Rows; removedNodes: Rows }>) => {
  if (!observer) return;
  for (const change of Array.from(changes)) {
    change.removedNodes.forEach((node) => {
      if (node.nodeType === 1) observer.unobserve(node as never);
    });
    change.addedNodes.forEach((node) => {
      if (node.nodeType === 1) observer.observe(node as never);
    });
  }
};

const findScroller = (
  container: ScrollerRef | undefined,
  root: HTMLElement,
  target: "parent" | "page",
  vertical: boolean,
): HTMLElement | Window | null => {
  if (container) {
    if (typeof container === "string") return document.querySelector<HTMLElement>(container);
    return "current" in container ? container.current : container;
  }
  if (target === "page") return window;
  const scrolls = (node: HTMLElement) => {
    const style = getComputedStyle(node);
    return /(auto|scroll|overlay)/.test(vertical ? style.overflowY : style.overflowX);
  };
  return nearestScroller<HTMLElement>(root, scrolls, document.body);
};

/** A layout effect in the page (measured before the first paint, so no flash), an effect when
    rendered to markup (where a layout effect only warns). */
const useIsomorphicLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

/** Whether a finger holds the device (platform/device.ts). */
const touchDevice = () =>
  typeof document !== "undefined" && document.documentElement.dataset.input === "touch";

export type GradualBlurProps = {
  position?: BlurEdge;
  target?: "parent" | "page";
  height?: string | number;
  width?: string | number;
  strength?: number;
  layers?: number;
  /** The most layers drawn by a finger (each is redrawn every scrolled frame on a phone). */
  touchLayers?: number;
  curve?: BlurCurve;
  exponential?: boolean;
  opacity?: number;
  saturation?: number;
  tint?: string;
  autoHide?: boolean;
  container?: ScrollerRef;
  hoverIntensity?: number;
  duration?: number | string;
  easing?: string;
  zIndex?: number;
  className?: string;
  style?: CSSProperties;
};

export default function GradualBlur({
  position = "bottom",
  target = "parent",
  height = "6rem",
  width,
  strength = 2,
  layers = 8,
  touchLayers = TOUCH_LAYERS,
  curve = "linear",
  exponential = true,
  opacity = 1,
  saturation = 1,
  tint = "transparent",
  autoHide = false,
  container,
  hoverIntensity = 1,
  duration = 0.3,
  easing = "ease-out",
  zIndex = 1000,
  className = "",
  style,
}: GradualBlurProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const edge: BlurEdge = DIRECTIONS[position] ? position : "bottom";
  const vertical = edge === "top" || edge === "bottom";
  const count = touchDevice() ? Math.min(layers, Math.max(1, Math.min(touchLayers, TOUCH_LAYERS))) : layers;
  const blurred = usePerfTier() === "full";

  const stack = useMemo(
    () => blurStack({ edge, layers: count, curve, strength, exponential, saturation, opacity, tint, duration, easing }),
    [edge, count, curve, strength, exponential, saturation, opacity, tint, duration, easing],
  );

  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (!autoHide) {
      root.style.removeProperty("--gradual-blur-reveal");
      return undefined;
    }
    const start = edge === "top" || edge === "left";
    let scroller: HTMLElement | Window | null = null;
    let observer: ResizeObserver | null = null;
    let rows: MutationObserver | null = null;
    let frame = 0;
    /** The reveal last set. */
    let shown: string | null = null;

    const measure = () => {
      frame = 0;
      if (!scroller) return;
      const element = scroller instanceof Window ? null : scroller;
      const page = document.documentElement;
      const offset = element
        ? vertical ? element.scrollTop : element.scrollLeft
        : vertical ? window.scrollY : window.scrollX;
      const limit = element
        ? vertical ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth
        : vertical ? page.scrollHeight - window.innerHeight : page.scrollWidth - window.innerWidth;
      const box = root.getBoundingClientRect();
      const reach = Math.max(vertical ? box.height : box.width, 1);
      const room = start ? offset : limit - offset;
      // Set only when it changes: this runs on every frame the page scrolls
      // (Smart Read and auto-scroll move it all the time), and it is all but
      // always fully shown.
      const reveal = clamp01(room / reach).toFixed(3);
      if (reveal !== shown) {
        shown = reveal;
        root.style.setProperty("--gradual-blur-reveal", reveal);
      }
    };
    // One reading a frame, however many scroll events arrive in it.
    const update = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const attach = () => {
      const found = findScroller(container, root, target, vertical);
      if (!found || found === scroller) return;
      detach();
      scroller = found;
      scroller.addEventListener("scroll", update, { passive: true });
      if (!(scroller instanceof Window) && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(update);
        observer.observe(scroller);
        // What it holds growing or shrinking (its first child may be an edge's empty strip).
        for (const child of Array.from(scroller.children).slice(0, 40)) observer.observe(child);
      }
      // Rows arriving while the scroller's own box stays the same size: watch them too.
      if (!(scroller instanceof Window) && typeof MutationObserver !== "undefined") {
        const element = scroller;
        rows = new MutationObserver((changes) => {
          followRows(observer, changes);
          update();
        });
        rows.observe(element, { childList: true });
      }
      measure();
    };
    const detach = () => {
      scroller?.removeEventListener("scroll", update);
      observer?.disconnect();
      observer = null;
      rows?.disconnect();
      rows = null;
      scroller = null;
    };

    attach();
    // Nothing to watch yet (the list mounts after us): hidden until there is.
    if (!scroller) {
      shown = "0";
      root.style.setProperty("--gradual-blur-reveal", "0");
    }
    const parent = root.parentElement;
    const children = parent && typeof MutationObserver !== "undefined" ? new MutationObserver(attach) : null;
    if (parent) children?.observe(parent, { childList: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      children?.disconnect();
      window.removeEventListener("resize", update);
      detach();
    };
  }, [autoHide, container, target, edge, vertical]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || hoverIntensity === 1) return undefined;
    let frame = 0;
    let inside = false;
    let point: { x: number; y: number } | null = null;

    const check = () => {
      frame = 0;
      if (!point) return;
      const box = root.getBoundingClientRect();
      const now = point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
      if (now === inside) return;
      inside = now;
      root.style.setProperty("--gradual-blur-hover", inside ? String(Math.max(hoverIntensity, 0)) : "1");
    };
    const onMove = (event: PointerEvent) => {
      point = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(check);
    };
    const onLeave = () => {
      point = null;
      inside = false;
      root.style.setProperty("--gradual-blur-hover", "1");
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      root.style.removeProperty("--gradual-blur-hover");
    };
  }, [hoverIntensity]);

  const depth = toLength(vertical ? height : (width ?? height));
  const span = vertical && width != null ? toLength(width) : null;
  const rounded = target !== "page" && !span;
  const corner = (a: BlurEdge, b: BlurEdge) => (rounded && (edge === a || edge === b) ? "inherit" : undefined);

  const rootStyle: CSSProperties = {
    position: target === "page" ? "fixed" : "absolute",
    zIndex,
    borderTopLeftRadius: corner("top", "left"),
    borderTopRightRadius: corner("top", "right"),
    borderBottomLeftRadius: corner("bottom", "left"),
    borderBottomRightRadius: corner("bottom", "right"),
    top: edge === "bottom" ? undefined : 0,
    bottom: edge === "top" ? undefined : 0,
    left: edge === "right" ? undefined : 0,
    right: edge === "left" ? undefined : 0,
    height: vertical ? depth : undefined,
    width: vertical ? (span ?? undefined) : depth,
    marginInline: span ? "auto" : undefined,
    ...style,
  };

  return (
    <div ref={rootRef} className={`gradual-blur ${className}`.trim()} style={rootStyle} aria-hidden="true" data-edge={edge}>
      {blurred && stack.steps.map((layer, index) => (
        <div key={index} className="gradual-blur-layer" style={layer} />
      ))}
      {stack.wash && <div className="gradual-blur-wash" style={stack.wash} />}
    </div>
  );
}
