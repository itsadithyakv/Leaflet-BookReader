/**
 * The click a phone sends after a finger's tap, when the tap has already
 * been taken by the picture.
 *
 * The camp's picture acts on the press (a building is chosen the moment the
 * finger lands, so a drag can follow). A tap that chooses a building opens
 * its panel, often right under the finger; then, when the finger lifts, the
 * browser sends the tap's click as well, at the same spot, and it lands on
 * whatever is there now: a tile on the panel's shelf (the burrow's, as often
 * as not), which chooses that instead. That click is a ghost of a tap
 * already handled, and is dropped.
 *
 * It is a ghost when it comes soon after a finger's press on the picture,
 * at the same spot, and lands on something other than the picture itself.
 */
export type Press = { x: number; y: number; at: number; target: EventTarget | null };

/** How long after the press, in milliseconds, its click can still come; and how far from it, in CSS pixels. */
export const GHOST_MS = 600;
export const GHOST_SLOP = 16;

export const isGhostClick = (press: Press | null, click: Press, within = GHOST_MS, slop = GHOST_SLOP) =>
  Boolean(
    press &&
      click.target !== press.target &&
      click.at - press.at >= 0 &&
      click.at - press.at <= within &&
      Math.hypot(click.x - press.x, click.y - press.y) <= slop
  );
