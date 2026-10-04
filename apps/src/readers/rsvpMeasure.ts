/**
 * A word on SpeedRead's stage, as the stage's stylesheet needs it: where the
 * spot is, and how far the word reaches either side of it.
 *
 * The reach is measured (the letters' real widths in the stage's own face),
 * and the stylesheet fits the word to the stage's real width. Both used to
 * be estimates against the tightest stage there could be: long words were
 * set smaller on a wide window with room to spare either side.
 */

import { RSVP_ANCHOR_EM, RSVP_EDGE, rsvpExtents, rsvpFit, rsvpPivotIndex } from "./rsvpWord";

/** The stage's face (see `.reader-rsvp-line`), at a size that makes an em a hundred pixels. */
const STAGE_FONT = '600 100px Georgia, Cambria, "Times New Roman", serif';
/** The line's letter spacing, in em. */
const TRACKING = 0.01;

let pen: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/** Text's width in ems of the stage's type, or null where it cannot be measured (no canvas). */
const measuredEm = (text: string): number | null => {
  if (!text) {
    return 0;
  }
  const known = widths.get(text);
  if (known !== undefined) {
    return known;
  }
  if (pen === undefined) {
    try {
      pen = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
      if (pen) {
        pen.font = STAGE_FONT;
      }
    } catch {
      pen = null;
    }
  }
  if (!pen) {
    return null;
  }
  const width = pen.measureText(text).width / 100 + TRACKING * Array.from(text).length;
  if (widths.size > 6000) {
    widths.clear();
  }
  widths.set(text, width);
  return width;
};

/**
 * The pivot letter of a word, and the stage's variables for it:
 * `--rsvp-anchor` (the spot), `--rsvp-left` and `--rsvp-right` (the word's
 * reach either side of the spot, in em), and `--rsvp-fit` (the older
 * estimate, for a browser that cannot size type by its container).
 */
export const rsvpStageVars = (text: string, punctuation: string) => {
  const pivot = rsvpPivotIndex(text);
  const shown = `${text}${punctuation}`;
  const measurable = measuredEm("n") !== null;
  const reach = measurable ? rsvpExtents(shown, pivot, (part) => measuredEm(part) ?? 0) : rsvpExtents(shown, pivot);
  return {
    pivot,
    style: {
      "--rsvp-anchor": `calc(50% - var(--rsvp-size) * ${RSVP_ANCHOR_EM})`,
      "--rsvp-anchor-em": RSVP_ANCHOR_EM,
      "--rsvp-edge": RSVP_EDGE,
      "--rsvp-left": Math.max(0.05, reach.left).toFixed(3),
      "--rsvp-right": Math.max(0.05, reach.right).toFixed(3),
      "--rsvp-fit": rsvpFit(shown, pivot)
    } as Record<string, string | number>
  };
};
