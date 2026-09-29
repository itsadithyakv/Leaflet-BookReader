/**
 * Where the Pip tab's small floating things go: the packet picker over a
 * plot, the walkthrough's bubble by what it points at, and whether the lift
 * has room to show every floor.
 */

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * A popover beside `anchor`, inside `bounds`: on the side preferred when it
 * fits, else the other side when that fits, else whichever has more room
 * (and then kept on screen). Centred on the anchor, slid along to stay in
 * bounds, with `tailAt` saying where along its edge the anchor is (percent),
 * so its tail can still point at it.
 */
export const placeNear = (anchor: Rect, size: Size, bounds: Rect, { gap = 10, prefer = "above" as "above" | "below" } = {}) => {
  const roomAbove = anchor.top - gap - bounds.top;
  const roomBelow = bounds.top + bounds.height - (anchor.top + anchor.height + gap);
  const fits = { above: roomAbove >= size.height, below: roomBelow >= size.height };
  const other = prefer === "above" ? "below" : "above";
  const side: "above" | "below" = fits[prefer] ? prefer : fits[other] ? other : roomAbove >= roomBelow ? "above" : "below";
  const top = clamp(
    side === "above" ? anchor.top - gap - size.height : anchor.top + anchor.height + gap,
    bounds.top,
    Math.max(bounds.top, bounds.top + bounds.height - size.height)
  );
  const middle = anchor.left + anchor.width / 2;
  const left = clamp(middle - size.width / 2, bounds.left, Math.max(bounds.left, bounds.left + bounds.width - size.width));
  const tailAt = clamp(((middle - left) / Math.max(1, size.width)) * 100, 10, 90);
  return { left, top, side, tailAt };
};

/** One floor's stop in the lift, and an arrow button, in CSS pixels. */
export const LIFT_STOP = 34;
export const LIFT_ARROW = 30;

/**
 * Whether every floor fits as its own stop in a lift this tall (with the up
 * and down arrows). When not (a short room, a tall house), the lift shows
 * just the floor it is on, and a list opens from it.
 */
export const liftShowsAll = (floors: number, height: number) => floors * LIFT_STOP + LIFT_ARROW * 2 + 12 <= height;
