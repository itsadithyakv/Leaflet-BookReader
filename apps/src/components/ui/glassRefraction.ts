// Liquid glass that bends what is behind it, after React Bits' <GlassSurface />
// (reactbits.dev), ported to TypeScript and cut to what Leaflet runs on: both
// the Windows app (WebView2) and the Android app (System WebView) are Chromium,
// which takes an SVG filter as a backdrop-filter. So only the SVG path is kept
// (no WebGL, no traced shapes); elsewhere the frosted fallback is drawn.
//
// How it bends: a displacement map the size of the surface, red rising toward
// one side and blue toward the bottom, flat grey in a calm centre. Chromium's
// feDisplacementMap moves each backdrop pixel by the map, so the edges act like
// the rim of a lens and the centre stays still. Each colour channel is moved a
// little differently, which splits light into faint fringes at the very edge.
//
// Two ways in:
// - <GlassSurface> (GlassSurface.tsx) wraps content in its own glass.
// - useGlassRefraction(ref, options) gives an element that already exists (a
//   bar, a pill) its own filter: it keeps one <svg> per surface in a hidden
//   holder on <body>, sizes the map to the element, and sets `--glass-filter`
//   on it. CSS then writes `backdrop-filter: var(--glass-filter) saturate(..)`
//   under `html.glass-refracts` (set by installGlassRefraction), with a plain
//   blur for everything else.
//
// Only on the full visual-effects tier (platform/perfTier.ts): on Smooth and
// minimal nothing of the lens is installed, no SVG filter and no `--glass-filter`.

import { useEffect, type RefObject } from "react";
import { currentTier, onTier, usePerfTier } from "../../platform/perfTier";

export type GlassBend = {
  /** How strongly the edge bends what is behind it. Negative pulls the view inward. */
  distortionScale?: number;
  /** Width of the bending edge, as a fraction of the shorter side. */
  borderWidth?: number;
  /** Softness from the bending edge to the calm centre, in px. */
  blur?: number;
  /** Brightness of the calm centre, in %. 50 leaves it undistorted. */
  brightness?: number;
  /** How strongly the calm centre holds the view still, 0 to 1. */
  opacity?: number;
  /** Blurs the light coming through, for a frosted look (px). */
  displace?: number;
  redOffset?: number;
  greenOffset?: number;
  blueOffset?: number;
  xChannel?: "R" | "G" | "B";
  yChannel?: "R" | "G" | "B";
  mixBlendMode?: string;
};

export const GLASS_BEND_DEFAULTS: Required<GlassBend> = {
  distortionScale: -180,
  borderWidth: 0.07,
  blur: 11,
  brightness: 50,
  opacity: 0.93,
  displace: 0,
  redOffset: 0,
  greenOffset: 10,
  blueOffset: 20,
  xChannel: "R",
  yChannel: "G",
  mixBlendMode: "difference",
};

/** The displacement map for a surface of this size and radius, as an SVG data URL. */
export const displacementMap = (
  width: number,
  height: number,
  radius: number,
  bend: GlassBend,
  id: string,
): string => {
  const o = { ...GLASS_BEND_DEFAULTS, ...bend };
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const edge = Math.min(w, h) * (o.borderWidth * 0.5);
  const svg =
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<linearGradient id="r-${id}" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient>` +
    `<linearGradient id="b-${id}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient>` +
    `<filter id="s-${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${o.blur}"/></filter>` +
    `</defs>` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="black"/>` +
    `<rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="url(#r-${id})"/>` +
    `<rect x="0" y="0" width="${w}" height="${h}" rx="${r}" fill="url(#b-${id})" style="mix-blend-mode: ${o.mixBlendMode}"/>` +
    `<rect x="${edge}" y="${edge}" width="${Math.max(0, w - edge * 2)}" height="${Math.max(0, h - edge * 2)}" rx="${r}" fill="hsl(0 0% ${o.brightness}% / ${o.opacity})" filter="url(#s-${id})"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const SVG_NS = "http://www.w3.org/2000/svg";

const channelMatrix = (keep: 0 | 1 | 2) =>
  [0, 1, 2].map((row) => (row === keep ? [0, 0, 0, 0, 0].map((_, i) => (i === row ? 1 : 0)) : [0, 0, 0, 0, 0]).join(" ")).join(" ") +
  " 0 0 0 1 0";

/**
 * Builds the <filter> into `defs`; returns what has to change when the surface or the settings do.
 *
 * The map is laid over the surface in px from its top-left corner (a backdrop filter's user space):
 * `width="100%"` there is a share of the window, not of the surface, and put a phone's whole map
 * askew (2026-10-19). `stretch` instead lays one map over any surface (the filter in the surface's
 * bounding box: LiquidGlassDefs.tsx), and its scales are then shares of the surface's size.
 */
export const buildGlassFilter = (defs: SVGElement, id: string, stretch = false) => {
  const doc = defs.ownerDocument;
  const make = (tag: string, attrs: Record<string, string>) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const filter = make("filter", { id, "color-interpolation-filters": "sRGB", x: "0%", y: "0%", width: "100%", height: "100%" });
  if (stretch) filter.setAttribute("primitiveUnits", "objectBoundingBox");
  const image = make("feImage", {
    x: "0",
    y: "0",
    width: stretch ? "1" : "100%",
    height: stretch ? "1" : "100%",
    preserveAspectRatio: "none",
    result: "map",
  });
  filter.appendChild(image);
  const channels = (["red", "green", "blue"] as const).map((name, i) => {
    const displace = make("feDisplacementMap", { in: "SourceGraphic", in2: "map", result: `d-${name}` });
    filter.appendChild(displace);
    filter.appendChild(make("feColorMatrix", { in: `d-${name}`, type: "matrix", values: channelMatrix(i as 0 | 1 | 2), result: name }));
    return displace;
  });
  filter.appendChild(make("feBlend", { in: "red", in2: "green", mode: "screen", result: "rg" }));
  filter.appendChild(make("feBlend", { in: "rg", in2: "blue", mode: "screen", result: "output" }));
  const soften = make("feGaussianBlur", { in: "output", stdDeviation: "0.7" });
  filter.appendChild(soften);
  defs.appendChild(filter);

  return (width: number, height: number, radius: number, bend: GlassBend) => {
    const o = { ...GLASS_BEND_DEFAULTS, ...bend };
    image.setAttribute("href", displacementMap(width, height, radius, o, id));
    if (!stretch) {
      image.setAttribute("width", String(Math.max(1, Math.round(width))));
      image.setAttribute("height", String(Math.max(1, Math.round(height))));
    }
    const offsets = [o.redOffset, o.greenOffset, o.blueOffset];
    channels.forEach((node, i) => {
      node.setAttribute("scale", String(o.distortionScale + offsets[i]));
      node.setAttribute("xChannelSelector", o.xChannel);
      node.setAttribute("yChannelSelector", o.yChannel);
    });
    soften.setAttribute("stdDeviation", String(o.displace));
  };
};

let probed: boolean | null = null;

/** Chromium bends a backdrop through an SVG filter; Safari and Firefox take the syntax and draw nothing. */
export const glassCanRefract = (): boolean => {
  if (probed !== null) return probed;
  if (typeof document === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const webkitOnly = /Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  if (webkitOnly || /Firefox/.test(ua) || /jsdom/i.test(ua)) return (probed = false);
  const probe = document.createElement("div");
  probe.style.setProperty("backdrop-filter", "url(#leaflet-probe)");
  probed = probe.style.getPropertyValue("backdrop-filter") !== "";
  return probed;
};

/** Whether the lens is drawn now: the WebView can, and the visual effects are full. */
export const lensDrawn = (): boolean => currentTier() === "full" && glassCanRefract();

let marking: (() => void) | null = null;
/** Marks <html> with `glass-refracts` while the bend is drawn (main.tsx, once; kept as the tier changes). */
export const installGlassRefraction = () => {
  if (typeof document === "undefined") return;
  const mark = () => document.documentElement.classList.toggle("glass-refracts", lensDrawn());
  mark();
  if (!marking) marking = onTier(mark);
};

let holder: SVGSVGElement | null = null;
let count = 0;

const filterHolder = () => {
  if (holder && holder.isConnected) return holder;
  holder = document.createElementNS(SVG_NS, "svg");
  holder.setAttribute("aria-hidden", "true");
  holder.setAttribute("width", "0");
  holder.setAttribute("height", "0");
  holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  holder.appendChild(document.createElementNS(SVG_NS, "defs"));
  document.body.appendChild(holder);
  return holder;
};

/**
 * Gives an existing element its own bending filter, kept the size of the element,
 * as `--glass-filter: url(#…)`. Off (nothing set) where the bend cannot be drawn,
 * or while `enabled` is false.
 */
export const useGlassRefraction = (
  ref: RefObject<HTMLElement | null>,
  bend: GlassBend = {},
  enabled = true,
) => {
  const key = JSON.stringify(bend);
  const full = usePerfTier() === "full";
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled || !full || !glassCanRefract()) return undefined;
    const id = `leaflet-glass-${++count}`;
    const defs = filterHolder().firstChild as SVGElement;
    const update = buildGlassFilter(defs, id);
    const settings = JSON.parse(key) as GlassBend;
    let last = "";
    const fit = () => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (!width || !height) return;
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      const size = `${width}x${height}x${radius}`;
      if (size === last) return;
      last = size;
      update(width, height, radius, settings);
    };
    fit();
    element.style.setProperty("--glass-filter", `url(#${id})`);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      element.style.removeProperty("--glass-filter");
      defs.querySelector(`#${id}`)?.remove();
    };
  }, [ref, key, enabled, full]);
};
