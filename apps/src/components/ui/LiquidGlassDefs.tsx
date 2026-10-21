// The app's shared liquid-glass lenses: two SVG filters, mounted once at the
// app's root (App.tsx), that any surface can bend what is behind it through.
//
// How to use (no import needed; it is all CSS once this is mounted):
//   - Put `.liquid-pill` (a capsule) or `.liquid-control` (keeps its own radius)
//     on a small floating control, or `.liquid-glass` on a floating panel with
//     text (styles/glass.css). Or write your own rule from the tokens:
//       backdrop-filter: var(--liquid-filter);        small controls
//       backdrop-filter: var(--liquid-filter-panel);  bars, menus, sheets
//       background-color: var(--liquid-tint) / var(--liquid-tint-text);
//       background-image: var(--liquid-sheen);
//       box-shadow: var(--liquid-rim), var(--liquid-shadow);
//   - The tokens resolve to a plain blur wherever the bend cannot be drawn
//     (not Chromium, `.no-glass`, reduced transparency) and, by a finger, the
//     panel one always does (a large lens redrawn every scrolled frame costs a
//     phone too much): only `--liquid-filter` bends there.
//   - The lens map is stretched to each surface (the filter is in the surface's
//     bounding box), so one filter serves every size, its bend in proportion; a
//     big surface that wants a lens drawn to its own size uses
//     useGlassRefraction (glassRefraction.ts).
//   - Never put a liquid surface inside another glass surface or inside an
//     element with opacity < 1, a filter or a mask: it would bend nothing.
//
// The ids are stable API: `leaflet-liquid` (capsules and small keys) and
// `leaflet-liquid-panel` (rounded panels and bars).

import { useEffect, useRef } from "react";
import { buildGlassFilter, glassCanRefract, type GlassBend } from "./glassRefraction";
import { usePerfTier } from "../../platform/perfTier";

export type LiquidLens = { width: number; height: number; radius: number; bend: GlassBend };

/**
 * The two lenses, drawn at a typical size and stretched to each surface. Their scales are shares
 * of the surface's size (the filter is in its bounding box), so a small key bends a little and a
 * wide bar more, each in proportion.
 */
export const LIQUID_LENSES: Record<"leaflet-liquid" | "leaflet-liquid-panel", LiquidLens> = {
  // A capsule or a small key: the bend runs round its ends.
  "leaflet-liquid": {
    width: 240,
    height: 64,
    radius: 32,
    bend: { distortionScale: -0.2, greenOffset: 0.008, blueOffset: 0.016, borderWidth: 0.1, blur: 5, brightness: 50, opacity: 0.97, displace: 0 },
  },
  // A panel or a bar: a calm, wide centre and a narrow lens round its edge.
  "leaflet-liquid-panel": {
    width: 480,
    height: 320,
    radius: 24,
    bend: { distortionScale: -0.1, greenOffset: 0.005, blueOffset: 0.01, borderWidth: 0.06, blur: 12, brightness: 50, opacity: 0.97, displace: 0 },
  },
};

export default function LiquidGlassDefs() {
  const defsRef = useRef<SVGDefsElement>(null);
  // Only on the full visual effects (platform/perfTier.ts): on Smooth no lens is installed at all.
  const full = usePerfTier() === "full";

  useEffect(() => {
    const defs = defsRef.current;
    if (!defs || !full || !glassCanRefract()) return undefined;
    const ids = Object.keys(LIQUID_LENSES) as (keyof typeof LIQUID_LENSES)[];
    for (const id of ids) {
      const lens = LIQUID_LENSES[id];
      buildGlassFilter(defs, id, true)(lens.width, lens.height, lens.radius, lens.bend);
    }
    return () => {
      for (const id of ids) defs.querySelector(`#${id}`)?.remove();
    };
  }, [full]);

  if (!full) return null;
  // Not `display: none`: a filter in an undisplayed <svg> is not drawn.
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      <defs ref={defsRef} />
    </svg>
  );
}
