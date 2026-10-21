// The reader's scroll edges: where the text (or a panel's list) scrolls out
// under a bar, it goes soft, a ramp of blur fading into the page's colour
// (components/ui/GradualBlur), as on a Mac or an iPhone, instead of being cut
// by a hard line.
//
// What is drawn where (readers/text/ReaderEdges.tsx, readers/ListEdges.tsx):
// - Scrolling a book on a wide screen: under the toolbar, a ramp as deep as
//   the bar and a little more (the bar's buttons float on it, the title reads
//   over it); a thin one at the window's top while the bar is away; one at
//   the foot, under the dock.
// - On a phone: thin ones only, at the top of the page (under the status bar)
//   and over the strip at its foot. Every layer is a backdrop blur redrawn on
//   every frame the text moves, so a phone gets three, and none at all (the
//   colour's fade alone) while Smart Read, auto-scroll or read aloud is moving
//   the text.
// - Turning pages there is nothing under the bars: no ramps.
// - A list in a panel fades into the panel's tint, without blur (`listEdge`).
// The text being read stays sharp: the ramps are shallow and their blur grows
// toward the edge (exponentially), so a line a ramp's depth from the edge is
// all but untouched.

import type { GradualBlurProps } from "../components/ui/GradualBlur";

export type PageEdge = "bar" | "top" | "foot";

export type PageEdgeRamp = {
  edge: PageEdge;
  props: GradualBlurProps;
  /** Draw the colour's fade only (no blur): the text is being moved for the reader. */
  tintOnly: boolean;
};

export type PageEdgeState = {
  /** The pages layout: nothing scrolls under the bars. */
  paged: boolean;
  /** SpeedRead's stage is over the page. */
  speed: boolean;
  /** A phone (upright or sideways): the slim layout. */
  phone: boolean;
  /** Read by finger (a phone or a tablet): the cheaper ramps. */
  touch: boolean;
  /** Smart Read, auto-scroll or read aloud is moving the text. */
  moving: boolean;
};

/** Blur per step of `strength` (GradualBlur's): 12 px. A phone's ramps stay at or under 6 px. */
export const PHONE_EDGE_MAX_BLUR = 6;

/** How many backdrop layers a finger's device draws in one of these ramps at most. */
export const TOUCH_EDGE_LAYERS = 3;

const ramp = (edge: PageEdge, props: GradualBlurProps, tintOnly: boolean): PageEdgeRamp => ({
  edge,
  tintOnly,
  props: {
    curve: "linear",
    exponential: true,
    autoHide: true,
    zIndex: 2,
    duration: 0.3,
    ...props
  }
});

/** The ramps over a book's page, for how it is being read now. */
export const pageEdges = (state: PageEdgeState): PageEdgeRamp[] => {
  if (state.paged || state.speed) return [];
  const tintOnly = state.touch && state.moving;
  if (state.phone) {
    return [
      ramp("top", { position: "top", height: 24, strength: 0.5, layers: TOUCH_EDGE_LAYERS, tint: "var(--reader-edge-tint)" }, tintOnly),
      // On the strip the text stops at (readers/touch.css, `--reader-text-foot`), not the frame's foot.
      ramp(
        "foot",
        {
          position: "bottom",
          height: 28,
          strength: 0.5,
          layers: TOUCH_EDGE_LAYERS,
          tint: "var(--reader-edge-tint)",
          style: { bottom: "var(--reader-text-foot, 0px)" }
        },
        tintOnly
      )
    ];
  }
  return [
    ramp(
      "bar",
      {
        position: "top",
        height: "calc(var(--reader-toolbar-height, 76px) + 24px)",
        strength: 1.5,
        layers: state.touch ? 4 : 6,
        tint: "var(--reader-edge-tint-bar)"
      },
      tintOnly
    ),
    ramp("top", { position: "top", height: 28, strength: 0.75, layers: state.touch ? TOUCH_EDGE_LAYERS : 4, tint: "var(--reader-edge-tint)" }, tintOnly),
    ramp("foot", { position: "bottom", height: state.touch ? 48 : 56, strength: 1, layers: state.touch ? TOUCH_EDGE_LAYERS : 5, tint: "var(--reader-edge-tint)" }, tintOnly)
  ];
};

/**
 * The soft edges of a list in a reader's panel: only while there is more to
 * scroll that way. The colour's fade alone, no blur: every panel is glass (a
 * backdrop filter of its own, or a fade), so it is the backdrop root of
 * anything in it, and a blur layer there drew the panel's tint over itself a
 * second time, a dark band with hard ends across the list (seen in the
 * chapter list, 2026-10-19).
 */
export const listEdge = (position: "top" | "bottom"): GradualBlurProps => ({
  position,
  height: position === "top" ? 28 : 36,
  strength: 0,
  layers: 1,
  curve: "linear",
  exponential: true,
  autoHide: true,
  zIndex: 2,
  duration: 0.25,
  tint: "var(--reader-list-edge-tint, var(--reader-glass-tint-strong))"
});
