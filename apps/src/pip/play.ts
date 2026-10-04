/**
 * Playing with Pip: what the reader's hand does to her, worked out here and
 * drawn by the house scene. A poke that is answered differently each time it
 * comes again, strokes told from tickles, the swing of a Pip held by her
 * leaf, the arc of a Pip (or a ball) let go of. All pure: a state, what
 * happened, the state after (play.test.ts).
 */

// ---- pokes ------------------------------------------------------------------------
//
// One poke startles her. Keep poking and she giggles, then gets dizzy, then
// has had enough; left alone a few seconds, she forgets and the next poke is
// the first again. So poking her is a little game, not one clip on repeat.

/** Left alone this long, she has forgotten being poked. */
export const POKE_CALM_MS = 5000;

export type Poke = { count: number; at: number };

/** The poke count after another poke at `now`. */
export const pokeAgain = (last: Poke | null, now: number): Poke => ({
  count: last && now - last.at < POKE_CALM_MS ? last.count + 1 : 1,
  at: now
});

export type PokeSound = "squeak" | "giggle";

export type PokeReaction = {
  move: string;
  loops: number;
  line: string | null;
  sound: PokeSound;
  /** Higher each time, so the pokes climb. */
  pitch: number;
  /** Past the last rung: one of her party pieces (the page's pool of surprises), and the count starts again. */
  surprise?: boolean;
};

const LADDER: PokeReaction[] = [
  { move: "boop", loops: 1, line: null, sound: "squeak", pitch: 1 },
  { move: "boop", loops: 1, line: "hee!", sound: "squeak", pitch: 1.18 },
  { move: "laugh", loops: 1, line: "that tickles!", sound: "giggle", pitch: 1 },
  { move: "dizzy", loops: 1, line: "whoa. the room is spinning.", sound: "squeak", pitch: 0.8 },
  { move: "steamed", loops: 1, line: "okay, okay! i felt that.", sound: "squeak", pitch: 0.65 }
];

/** How she answers the nth poke in a row (1 is the first). */
export const pokeReaction = (count: number): PokeReaction =>
  count <= LADDER.length ? LADDER[Math.max(1, count) - 1] : { move: "cheer", loops: 1, line: null, sound: "giggle", pitch: 1.2, surprise: true };

/** How many pokes in a row have their own answer before the surprise. */
export const POKE_RUNGS = LADDER.length;

// ---- strokes ------------------------------------------------------------------------
//
// The pointer rubbed back and forth over her is a stroke; rubbed fast, a
// tickle. Told from a pointer merely crossing her by the turns: a stroke
// changes direction, a crossing does not.

export type Stroke = {
  x: number;
  /** Which way the pointer is going, and how far it has gone that way. */
  dir: -1 | 0 | 1;
  run: number;
  /** When each change of direction came. */
  turns: number[];
};

export type Touch = "none" | "pet" | "tickle";

/** Turns older than this no longer count. */
const STROKE_WINDOW_MS = 1300;
/** This many turns inside the window is petting; this many, tickling. */
const PET_TURNS = 2;
const TICKLE_TURNS = 5;

export const strokeStart = (x: number): Stroke => ({ x, dir: 0, run: 0, turns: [] });

/**
 * The stroke after the pointer moves to `x` at `now`, and what it amounts to.
 * `unit` is Pip's width in the same pixels: a run counts as a stroke once it
 * is an eighth of her wide, so a tremble of the hand is not a tickle.
 */
export const strokeMove = (stroke: Stroke, x: number, now: number, unit: number): { stroke: Stroke; touch: Touch } => {
  const dx = x - stroke.x;
  const turns = stroke.turns.filter((at) => now - at < STROKE_WINDOW_MS);
  if (dx === 0) return { stroke: { ...stroke, turns }, touch: touchOf(turns) };
  const dir = dx > 0 ? 1 : -1;
  let run = stroke.run;
  let going = stroke.dir;
  if (going === 0) {
    going = dir;
    run = Math.abs(dx);
  } else if (dir === going) {
    run += Math.abs(dx);
  } else {
    // Turned round: it counts if the run before the turn was a real one.
    if (run >= unit / 8) turns.push(now);
    going = dir;
    run = Math.abs(dx);
  }
  return { stroke: { x, dir: going, run, turns }, touch: touchOf(turns) };
};

const touchOf = (turns: readonly number[]): Touch => (turns.length >= TICKLE_TURNS ? "tickle" : turns.length >= PET_TURNS ? "pet" : "none");

// ---- held by the leaf -------------------------------------------------------------------
//
// Picked up, Pip hangs from the hand by her leaf and swings: the hand's
// sideways acceleration drives her the other way, gravity brings her back,
// and the air slows her. An angle and how fast it is changing, in radians.

export type Swing = { angle: number; spin: number };

/** Gravity over the length she hangs by, per second squared: a swing of about a second. */
const SWING_PULL = 46;
const SWING_DRAG = 2.2;
/** How far she can swing either way: past level, not right over. */
const SWING_MAX = 2.2;
/** How long she hangs, in floor pixels: turns the hand's acceleration into a turn. */
const SWING_LENGTH = 26;

/** The swing a moment later, with the hand accelerating sideways at `accel` (floor pixels per second squared). */
export const swingStep = (swing: Swing, accel: number, dt: number): Swing => {
  const push = Math.max(-1400, Math.min(1400, accel)) / SWING_LENGTH;
  let spin = swing.spin + (-SWING_PULL * Math.sin(swing.angle) + push * Math.cos(swing.angle) - SWING_DRAG * swing.spin) * dt;
  spin = Math.max(-14, Math.min(14, spin));
  let angle = swing.angle + spin * dt;
  if (Math.abs(angle) > SWING_MAX) {
    angle = Math.sign(angle) * SWING_MAX;
    spin *= -0.3;
  }
  return { angle, spin };
};

/**
 * A Pip in the hand: how she swings, how fast the hand is going sideways now
 * (floor pixels a second), and how fast it was going when the swing was last
 * worked out. The difference between the two, over a frame, is the push.
 */
export type Hold = { swing: Swing; handVx: number; swungVx: number };

export const holdStart = (): Hold => ({ swing: { angle: 0, spin: 0 }, handVx: 0, swungVx: 0 });

/** The hand moved from `before` to `now`: its sideways speed is what it just did. */
export const holdMove = (hold: Hold, before: Sample | undefined, now: Sample): Hold =>
  before && now.at > before.at ? { ...hold, handVx: (now.x - before.x) / ((now.at - before.at) / 1000) } : hold;

/**
 * The hold a frame later. The hand's speed is only known while it moves, so
 * left alone it dies away (a hand that stops sending moves has stopped), and
 * she swings on past it, then settles under it. `still` (reduced motion)
 * carries her without the swing.
 */
export const holdStep = (hold: Hold, dt: number, still = false): Hold => {
  if (dt <= 0 || still) return still ? { ...holdStart(), handVx: hold.handVx } : hold;
  const accel = (hold.handVx - hold.swungVx) / dt;
  return { swing: swingStep(hold.swing, accel, dt), swungVx: hold.handVx, handVx: hold.handVx * Math.max(0, 1 - 9 * dt) };
};

/**
 * Held, she turns about the hand (at her leaf); in the air, about her middle,
 * this far below it. Letting go must not move her on screen, so the feet the
 * scene places her by shift to where the same picture is turned about the
 * middle (HouseScene keeps its two turning points this far apart).
 */
export const HOLD_REACH = 15.36;

// ---- let go ---------------------------------------------------------------------------------

export type Sample = { x: number; y: number; at: number };

/** How fast the hand was going as it let go: over the last tenth of a second, floor pixels a second. */
export const releaseVelocity = (samples: readonly Sample[], now: number): { vx: number; vy: number } => {
  const recent = samples.filter((sample) => now - sample.at <= 110);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = (last.at - first.at) / 1000;
  if (dt <= 0.004) return { vx: 0, vy: 0 };
  const cap = (value: number) => Math.max(-TOSS_MAX, Math.min(TOSS_MAX, value));
  return { vx: cap((last.x - first.x) / dt), vy: cap((last.y - first.y) / dt) };
};

/** Slower than this at letting go is a drop, not a toss (floor pixels a second). */
export const TOSS_MIN = 110;
/** The fastest a toss counts for: the room is small. */
export const TOSS_MAX = 420;
/** Landing faster than this (or still spinning) leaves her dizzy. */
export const HARD_LANDING = 330;

export const isToss = (velocity: { vx: number; vy: number }) => Math.hypot(velocity.vx, velocity.vy) >= TOSS_MIN;

export type Body = { x: number; y: number; vx: number; vy: number; angle: number; spin: number };
export type Bounds = { left: number; right: number; top: number; floor: number };

/** How much of her speed Pip keeps off the floor: a bounce or two, not a ball. */
export const PIP_BOUNCE = 0.36;

/**
 * Pip as the hand lets go of her: where she is (her feet, as the scene places
 * her), how she is moving and turning. The hand's speed carries her, and so
 * does her swing: let go at the bottom of one, she flies on the way she was
 * swinging. `tossed` says whether that is fast enough to be a throw.
 */
export const letGo = (feet: { x: number; y: number }, swing: Swing, hand: { vx: number; vy: number }): { body: Body; tossed: boolean } => {
  const sin = Math.sin(swing.angle);
  const cos = Math.cos(swing.angle);
  const cap = (value: number) => Math.max(-TOSS_MAX, Math.min(TOSS_MAX, value));
  const vx = cap(hand.vx - HOLD_REACH * swing.spin * cos);
  const vy = cap(hand.vy - HOLD_REACH * swing.spin * sin);
  const tossed = isToss({ vx, vy });
  return {
    body: {
      x: feet.x - HOLD_REACH * sin,
      y: feet.y - HOLD_REACH * (1 - cos),
      vx,
      vy,
      angle: swing.angle,
      // Thrown, she tumbles the way she is going; dropped, she only keeps the turn she had.
      spin: tossed ? swing.spin + vx * 0.03 : swing.spin
    },
    tossed
  };
};

/**
 * Pip caught out of the air: letting go, backwards. She hangs from the hand at
 * the tilt she had (the same picture, turned about the leaf now), and the
 * speed she was going swings her from the hand that stopped her.
 */
export const caught = (body: Body): { hold: Hold; feet: { x: number; y: number } } => {
  const angle = Math.max(-SWING_MAX, Math.min(SWING_MAX, nearUpright(body.angle)));
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const spin = Math.max(-10, Math.min(10, (-body.vx * cos - body.vy * sin) / SWING_LENGTH));
  return { hold: { ...holdStart(), swing: { angle, spin } }, feet: { x: body.x + HOLD_REACH * sin, y: body.y + HOLD_REACH * (1 - cos) } };
};

/** The same turn as `angle`, written between a half turn back and a half turn on: the short way to upright. */
export const nearUpright = (angle: number) => {
  const turn = Math.PI * 2;
  const rest = ((angle % turn) + turn) % turn;
  return rest > Math.PI ? rest - turn : rest;
};

const GRAVITY = 900;

/**
 * A thing in the air a moment later: gravity, a bounce off each wall and the
 * ceiling, and the floor. `bounce` is how much of its speed it keeps off the
 * floor (0: it lands and stays; a ball keeps about half). A ball rolls with
 * the floor it bounces on; a thing that `tumbles` (Pip) keeps turning the way
 * it was, slower. Says what it hit, and how hard it met the floor.
 */
export const flyStep = (body: Body, dt: number, bounds: Bounds, bounce = 0, tumbles = false): { body: Body; landed: boolean; hit: boolean; impact: number } => {
  let { x, y, vx, vy, angle, spin } = body;
  let hit = false;
  vy += GRAVITY * dt;
  x += vx * dt;
  y += vy * dt;
  angle += spin * dt;
  if (x < bounds.left) {
    x = bounds.left;
    vx = Math.abs(vx) * 0.55;
    spin *= -0.6;
    hit = true;
  } else if (x > bounds.right) {
    x = bounds.right;
    vx = -Math.abs(vx) * 0.55;
    spin *= -0.6;
    hit = true;
  }
  if (y < bounds.top) {
    y = bounds.top;
    vy = Math.abs(vy) * 0.4;
    hit = true;
  }
  let landed = false;
  let impact = 0;
  if (y >= bounds.floor) {
    y = bounds.floor;
    impact = vy;
    if (bounce > 0 && vy > 70) {
      // Up again, slower, and rolling a little less.
      vy = -vy * bounce;
      vx *= 0.8;
      spin = tumbles ? spin * 0.45 : vx * 0.12;
      hit = true;
    } else {
      vy = 0;
      landed = true;
    }
  }
  return { body: { x, y, vx, vy, angle, spin }, landed, hit, impact };
};

/** A ball on the floor rolls to a stop. Says when it has. */
export const rollStep = (body: Body, dt: number, bounds: Bounds): { body: Body; still: boolean } => {
  let { x, vx } = body;
  vx *= Math.max(0, 1 - 2.4 * dt);
  x += vx * dt;
  if (x < bounds.left) {
    x = bounds.left;
    vx = Math.abs(vx) * 0.5;
  } else if (x > bounds.right) {
    x = bounds.right;
    vx = -Math.abs(vx) * 0.5;
  }
  const still = Math.abs(vx) < 5;
  return { body: { ...body, x, vx: still ? 0 : vx, y: bounds.floor, vy: 0, angle: body.angle + vx * 0.12 * dt, spin: 0 }, still };
};

// ---- what counts as play ------------------------------------------------------------------------

/** The ways of playing that cheer Pip up (pip/mod.rs keeps the same list). */
export const PLAYS = ["pet", "tickle", "fetch", "toss", "dance"] as const;
export type PlayKind = (typeof PLAYS)[number];

/** The same kind of play counts again only after this long, so a held hand is one stroke, not fifty. */
export const PLAY_EVERY_MS = 6000;

/** Whether a bout of play at `now` counts, given when that kind last did. Pure, for the tests. */
export const playCounts = (last: number | undefined, now: number) => last === undefined || now - last >= PLAY_EVERY_MS;
