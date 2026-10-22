/** The smallest half step: 1.5 device pixels an art pixel (at 1 there is no smaller whole step to add half to). */
const MIN_HALF_STEP = 1.5;

/**
 * How big Pip's house is drawn: device pixels per art pixel, for a floor of
 * `artWidth` by `artHeight` in a box of `boxWidth` by `boxHeight` CSS pixels.
 *
 * Whole steps keep every art pixel the same size, but on their own they leave
 * much of the page empty on a narrow window: at 820 px the room was two
 * pixels a pixel, 480 px across in 680. So half steps count too (1.5, 2.5,
 * 3.5): the art's pixels alternate by one device pixel, which still reads as
 * the same pixel art, and the room fills most of what it is given. Never
 * fewer than one.
 */
export const sceneScale = (artWidth: number, artHeight: number, boxWidth: number, boxHeight: number, ratio = 1) => {
  const exact = Math.min((boxWidth * ratio) / artWidth, (boxHeight * ratio) / artHeight);
  const whole = Math.max(1, Math.floor(exact + 1e-6));
  const half = Math.floor(exact * 2 + 1e-6) / 2;
  return half >= MIN_HALF_STEP ? Math.max(whole, half) : whole;
};

/**
 * Where a room of `roomWidth` by `roomHeight` CSS pixels sits in the box it is fitted to, snapped to device
 * pixels: in the middle of it. (Where Pip's tab is the whole screen the box is what the HUD, the rail and the lift
 * leave clear, so nothing that can be tapped in the room is under one of them; its picture, drawn wide
 * (`roomPad`), fills the rest of the screen.)
 */
export const fillPlace = (roomWidth: number, roomHeight: number, boxWidth: number, boxHeight: number, ratio = 1) => {
  const snap = (value: number) => Math.round(value * ratio) / ratio;
  return { left: snap((boxWidth - roomWidth) / 2), top: snap((boxHeight - roomHeight) / 2) };
};

/** How far a floor's picture runs on past the room each side, in art pixels (house.js `renderLevel`'s `pad`). */
export type RoomPad = { left: number; right: number; top: number; bottom: number };
export const NO_PAD: RoomPad = { left: 0, right: 0, top: 0, bottom: 0 };
/** A pad is drawn in steps of this many art pixels, so a few pixels' change of the window does not draw the room again. */
export const PAD_STEP = 8;

/**
 * How much wider (and taller) than the room its picture is drawn where the room fills the screen: to the stage's
 * edges each side, in art pixels, in whole `PAD_STEP`s. `room`: where it is in the stage (CSS pixels); `scale`: CSS
 * pixels an art pixel. `was`: the pad drawn now, kept where it already reaches (a drawer opened and shut does not
 * draw the room twice over): a pad only grows, until the scale changes.
 */
export const roomPad = (stage: { width: number; height: number }, room: { left: number; top: number; width: number; height: number }, scale: number, was: RoomPad | null = null): RoomPad => {
  const art = (css: number) => Math.max(0, Math.ceil(Math.ceil(Math.max(0, css) / scale - 1e-6) / PAD_STEP) * PAD_STEP);
  const want = {
    left: art(room.left),
    right: art(stage.width - room.left - room.width),
    top: art(room.top),
    bottom: art(stage.height - room.top - room.height)
  };
  if (!was) return want;
  return { left: Math.max(want.left, was.left), right: Math.max(want.right, was.right), top: Math.max(want.top, was.top), bottom: Math.max(want.bottom, was.bottom) };
};

/** A rectangle in the stage, in CSS pixels. */
export type Edges = { left: number; top: number; right: number; bottom: number };

/**
 * Pip's floor where the room fills the screen, in the room's art pixels (0 is the room's left wall, and it can be
 * less): from the left of the screen (inside its gutter) to short of the rail (or a drawer), so she walks, is
 * thrown and plays along all the floor that shows and never under the rail. The lift is a key at the top-left,
 * over the wall, not the floor: `notch` is the corner it takes, which she is kept out of in the air.
 * `box`: what the HUD, the rail and the lift leave clear (the stage's content box); `lift`: the lift's box, or null
 * with none. `edge`: the picture's right-hand edge (where she comes in from outside).
 */
export type FloorSpan = { left: number; right: number; notch: { x: number; y: number } | null; edge: number };
/** Kept between Pip (or a visitor) and the lift, CSS pixels. */
export const LIFT_CLEAR = 4;

export const floorSpan = (box: Edges, lift: Edges | null, room: { left: number; top: number }, scale: number, roomWidth: number, pad: RoomPad): FloorSpan => {
  const x = (css: number) => (css - room.left) / scale;
  const left = lift ? Math.min(box.left, lift.left) : box.left;
  return {
    left: x(left),
    right: x(box.right),
    notch: lift ? { x: x(lift.right + LIFT_CLEAR), y: (lift.bottom + LIFT_CLEAR - room.top) / scale } : null,
    edge: roomWidth + pad.right
  };
};

/** The floor of a room drawn alone (not filling the screen): wall to wall. */
export const roomSpan = (roomWidth: number): FloorSpan => ({ left: 0, right: roomWidth, notch: null, edge: roomWidth });

/**
 * A body `half` art pixels either side of `x` and `tall` above its feet at `y`, kept out of the span's notch (the
 * lift's corner): pushed out the short way, its speed that way turned back (and lost a little, as off a wall). Null
 * when it is clear.
 */
export const outOfNotch = (body: { x: number; y: number; vx: number; vy: number }, notch: FloorSpan["notch"], half = 16, tall = 30, bounce = 0.55) => {
  if (!notch) return null;
  const right = notch.x - (body.x - half);
  const down = notch.y - (body.y - tall);
  if (right <= 0 || down <= 0) return null;
  return right <= down ? { ...body, x: body.x + right, vx: Math.abs(body.vx) * bounce } : { ...body, y: body.y + down, vy: Math.abs(body.vy) * bounce };
};
