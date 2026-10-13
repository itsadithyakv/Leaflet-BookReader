/**
 * A game of catch with Pip.
 *
 * The ball used to be fetch and nothing else: thrown, run after, carried back
 * at a walk and put down, ten seconds a go, with nothing ever coming back to
 * the reader. The owner asked for more (2026-10-13: "the ball to play with
 * pip does not work that well, let her throw it back n stuff, make it cute").
 * This is the game, worked out here and played by the house scene:
 *
 * - **A ball with weight** (`ballStep`): gravity, a bounce that loses a little
 *   each time, a roll that comes to a clean stop, the walls and the ceiling.
 *   Stepped in fixed slices of time, so it flies the same at 30 frames a
 *   second and at 144, and a frame that took too long (the tab was hidden) is
 *   cut short rather than flung through the wall. How it is drawn is here too
 *   (`ballShape`, `shadowOf`, `spinFrame`): in whole pixels and whole steps,
 *   so nothing shimmers.
 * - **The reader's hand** (`flick`): how fast the ball leaves it, from where
 *   the pointer has just been. A slow let-go is a drop, not a throw.
 * - **Her throws** (`lob`, `throwTarget`, `throwSpot`, `underarm`): an arc
 *   that comes down where the pointer is, from a sensible distance.
 * - **How she takes one** (`receive`): mostly a catch; sometimes a header or
 *   a kick straight back; now and then it bonks her on the head or she jumps
 *   and misses. Seeded, so the same game plays the same way twice (the tests
 *   pin it); never on the first ball of a game, and never twice running.
 * - **The rally** (`Rally`): catches in a row, hers and the reader's. It makes
 *   her keener (`keenness`, `windupMs`), and a few of them are a game
 *   (`RALLY_IS_GAME`: pip/temper.ts takes it as `game`). It is play, not a
 *   meter: nothing is won by it, kept from it or lost when it ends.
 * - **Asking to play** (`askStage`): the reader has stopped. After a while she
 *   nudges the ball over; later she lies down with her chin on it; later
 *   still she puts it away herself. Never a word about it.
 *
 * All pure: a state, what happened, the state after (catch.test.ts).
 */
import type { Sample } from "./play";

// ---- a ball with weight ---------------------------------------------------------------
//
// Lighter than Pip (she falls at 900): a ball that hangs a moment at the top
// of its arc is one a hand can get under.

/** The ball's middle rests this far above the floor line (where Pip's feet go). */
export const BALL_RADIUS = 3;
/** Floor pixels a second, each second. */
export const BALL_GRAVITY = 640;
/** How much of its speed it keeps off the floor, the walls and the ceiling. */
export const BALL_BOUNCE = 0.58;
export const WALL_BOUNCE = 0.6;
export const CEILING_BOUNCE = 0.4;
/** Meeting the floor slower than this, it stays down and rolls. */
export const BOUNCE_MIN = 55;
/** Each bounce keeps this much of its sideways speed. */
const FLOOR_GRIP = 0.86;
/** Rolling: slowed in proportion to its speed, and by a steady drag besides, which is what brings it to a stop in the end. */
const ROLL_DRAG = 1.1;
const ROLL_GRIP = 40;
/** Rolling slower than this, it has stopped: no creeping along a pixel at a time. */
export const ROLL_STOP = 5;
/** It turns this many radians for each pixel it travels along the floor. */
const BALL_SPIN = 0.12;

/** The slice of time the ball is stepped in, however often the scene draws. */
export const BALL_STEP = 1 / 120;
/** The most time one frame may stand for: a tab hidden for a minute is not a minute of flight in one go. */
export const BALL_DT_MAX = 0.1;

export type Room = { left: number; right: number; top: number; floor: number };

/** The ball: where, how fast, how far round it has turned, whether it is down and rolling, and the sliver of time not yet stepped. */
export type BallBody = { x: number; y: number; vx: number; vy: number; angle: number; spin: number; down: boolean; rem: number };

/** What it met on the way, and how fast it was going. */
export type Hit = { on: "floor" | "wall" | "ceiling"; speed: number };

export const ballAt = (x: number, y: number, vx = 0, vy = 0): BallBody => ({ x, y, vx, vy, angle: 0, spin: vx * BALL_SPIN, down: false, rem: 0 });

/** The ball lying still on the floor at `x`. */
export const ballDown = (x: number, room: Room, angle = 0): BallBody => ({ x: Math.max(room.left, Math.min(room.right, x)), y: room.floor, vx: 0, vy: 0, angle, spin: 0, down: true, rem: 0 });

const slice = (ball: BallBody, room: Room, hits: Hit[]): BallBody => {
  const h = BALL_STEP;
  let { x, y, vx, vy, angle, spin, down } = ball;
  if (down) {
    // Rolling: it slows, and under a crawl it has stopped.
    const slow = (ROLL_DRAG * Math.abs(vx) + ROLL_GRIP) * h;
    vx = Math.abs(vx) <= slow ? 0 : vx - Math.sign(vx) * slow;
    if (Math.abs(vx) < ROLL_STOP) vx = 0;
    x += vx * h;
    angle += vx * BALL_SPIN * h;
    spin = 0;
    y = room.floor;
    vy = 0;
  } else {
    // (The fall over the slice is worked out whole, so an arc comes down exactly where `lob` says it will.)
    x += vx * h;
    y += vy * h + (BALL_GRAVITY * h * h) / 2;
    vy += BALL_GRAVITY * h;
    angle += spin * h;
    if (y < room.top) {
      y = room.top;
      hits.push({ on: "ceiling", speed: Math.abs(vy) });
      vy = Math.abs(vy) * CEILING_BOUNCE;
    }
    if (y >= room.floor) {
      y = room.floor;
      if (vy > BOUNCE_MIN) {
        // Up again, slower, turning with the floor it met.
        hits.push({ on: "floor", speed: vy });
        vy = -vy * BALL_BOUNCE;
        vx *= FLOOR_GRIP;
        spin = vx * BALL_SPIN;
      } else {
        vy = 0;
        down = true;
      }
    }
  }
  if (x < room.left) {
    x = room.left;
    hits.push({ on: "wall", speed: Math.abs(vx) });
    vx = Math.abs(vx) * WALL_BOUNCE;
    spin *= -0.6;
  } else if (x > room.right) {
    x = room.right;
    hits.push({ on: "wall", speed: Math.abs(vx) });
    vx = -Math.abs(vx) * WALL_BOUNCE;
    spin *= -0.6;
  }
  return { x, y, vx, vy, angle, spin, down, rem: 0 };
};

/** Whether it has come to rest. */
export const ballStill = (ball: BallBody) => ball.down && ball.vx === 0;

/**
 * The ball `dt` seconds later, and what it met on the way. Stepped in whole
 * slices of `BALL_STEP`, the part of a slice left over carried to next time,
 * so how often it is called makes no difference to where the ball goes.
 */
export const ballStep = (ball: BallBody, dt: number, room: Room): { ball: BallBody; hits: Hit[] } => {
  const hits: Hit[] = [];
  if (!(dt > 0) || ballStill(ball)) return { ball: ballStill(ball) ? { ...ball, rem: 0 } : ball, hits };
  let rem = ball.rem + Math.min(dt, BALL_DT_MAX);
  let next = ball;
  while (rem >= BALL_STEP) {
    next = slice(next, room, hits);
    rem -= BALL_STEP;
    if (ballStill(next)) {
      rem = 0;
      break;
    }
  }
  return { ball: { ...next, rem }, hits };
};

/** Where a ball in the air first comes down, and how long it takes (the walls and the ceiling on the way counted in). */
export const landing = (ball: BallBody, room: Room): { x: number; time: number } => {
  let next = { ...ball, rem: 0 };
  const hits: Hit[] = [];
  for (let time = 0; time < 4; time += BALL_STEP) {
    if (next.down || hits.some((hit) => hit.on === "floor")) return { x: next.x, time };
    next = slice(next, room, hits);
  }
  return { x: next.x, time: 4 };
};

// ---- how it is drawn -------------------------------------------------------------------
//
// Three pictures of the ball (pip/house-moves.js draws them): round, flat (a
// squash on the floor, or a stretch along a fast flight sideways) and tall (a
// squash on a wall, or a stretch along a fast rise or fall). Each is whole
// pixels, held for a moment: no in-between sizes to shimmer.

export type Shape = "round" | "flat" | "tall";

/** A hit shows as a squash for this long, if it was at least this hard. */
export const SQUASH_MS = 90;
export const SQUASH_SPEED = 120;
/** In the air faster than this, it stretches the way it is going. */
export const STRETCH_SPEED = 300;

/** The picture of the ball: `impact` is the last thing it met, and how long ago. */
export const ballShape = (ball: Pick<BallBody, "vx" | "vy" | "down">, impact: { on: Hit["on"]; speed: number; ago: number } | null): Shape => {
  if (impact && impact.ago >= 0 && impact.ago < SQUASH_MS && impact.speed >= SQUASH_SPEED) return impact.on === "wall" ? "tall" : "flat";
  if (ball.down) return "round";
  const across = Math.abs(ball.vx);
  const along = Math.abs(ball.vy);
  if (Math.hypot(across, along) < STRETCH_SPEED) return "round";
  // Clearly one way or the other; on a slant it is left round.
  if (along > across * 1.3) return "tall";
  if (across > along * 1.3) return "flat";
  return "round";
};

/** The ball is drawn turned in this many steps a turn. */
export const SPIN_FRAMES = 8;

/** Which of its turned pictures shows, from how far round it has rolled: it changes a step at a time. */
export const spinFrame = (angle: number) => {
  const step = Math.floor((angle / (Math.PI * 2)) * SPIN_FRAMES);
  return ((step % SPIN_FRAMES) + SPIN_FRAMES) % SPIN_FRAMES;
};

/**
 * The ball's shadow on the floor, from how high it is: half its width in
 * floor pixels, and whether it is the fainter of the two. Smaller and fainter
 * as the ball rises, in steps.
 */
export const shadowOf = (height: number): { half: number; faint: boolean } => {
  const up = Math.max(0, height);
  return { half: up < 5 ? 3 : up < 22 ? 2 : 1, faint: up >= 40 };
};

/** A hop where she stands: how many whole pixels she is off the floor, `ms` into a hop that lasts `lasts` and peaks at `high`. */
export const hopLift = (ms: number, lasts: number, high: number) => {
  if (ms <= 0 || ms >= lasts) return 0;
  const t = ms / lasts;
  return Math.round(4 * high * t * (1 - t));
};

// ---- the reader's hand -----------------------------------------------------------------

/** The ball's press area is at least this wide on screen, in CSS pixels, however small the ball is drawn. */
export const GRAB_MIN = 44;
/** How fast it leaves the hand is read from where the pointer was over this long. */
export const FLICK_WINDOW_MS = 80;
/** Slower than this at letting go is a drop; and no flick counts for more than `FLICK_MAX` (floor pixels a second). */
export const FLICK_MIN = 60;
export const FLICK_MAX = 420;

/** How fast the hand was going as it let go of the ball; nothing at all for a hand that had stopped. */
export const flick = (samples: readonly Sample[], now: number): { vx: number; vy: number } => {
  const recent = samples.filter((sample) => now - sample.at <= FLICK_WINDOW_MS);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = (last.at - first.at) / 1000;
  if (dt <= 0.004) return { vx: 0, vy: 0 };
  let vx = (last.x - first.x) / dt;
  let vy = (last.y - first.y) / dt;
  const speed = Math.hypot(vx, vy);
  if (speed < FLICK_MIN) return { vx: 0, vy: 0 };
  if (speed > FLICK_MAX) {
    // Capped along the way it was going, so a hard flick keeps its aim.
    vx *= FLICK_MAX / speed;
    vy *= FLICK_MAX / speed;
  }
  return { vx, vy };
};

// ---- her throws -------------------------------------------------------------------------

/** She throws from no nearer than this to where it is going, and no farther (floor pixels). */
export const THROW_NEAR = 40;
export const THROW_FAR = 90;
/** How long her throws are in the air, seconds: short ones still go up and come down. */
const LOB_MIN_S = 0.75;
const LOB_MAX_S = 1.05;

/**
 * The throw that leaves `from` and is at `to` on its way down: sideways and
 * upward speed, and how long it takes. `hang` stretches the time (a lazier
 * throw); the arc is kept under the ceiling.
 */
export const lob = (from: { x: number; y: number }, to: { x: number; y: number }, room: Room, hang = 1): { vx: number; vy: number; time: number } => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Long enough to be coming down when it gets there, however high the target.
  const least = Math.sqrt((2 * Math.max(0, -dy)) / BALL_GRAVITY) + 0.25;
  let time = Math.max(least, Math.min(LOB_MAX_S, LOB_MIN_S + Math.abs(dx) / 500) * hang);
  const rise = (t: number) => dy / t - (BALL_GRAVITY * t) / 2;
  // The top of the arc stays in the room: a shorter flight is a lower one.
  const head = Math.max(1, from.y - room.top - 4);
  while (time > least && rise(time) < 0 && (rise(time) * rise(time)) / (2 * BALL_GRAVITY) > head) time -= 0.03;
  time = Math.max(least, time);
  return { vx: dx / time, vy: rise(time), time };
};

/**
 * Where her throw is meant for: the pointer, kept inside the room and off the
 * floor; or, with no pointer in the room (the keyboard, a finger that has
 * lifted), the middle of the floor at the front. Never at her own feet: a
 * target nearer than a short throw is moved out to one, on the side with
 * more room.
 */
export const throwTarget = (pointer: { x: number; y: number } | null, pipX: number, room: Room): { x: number; y: number } => {
  const middle = (room.left + room.right) / 2;
  const wanted = pointer ?? { x: middle, y: room.floor };
  let x = Math.max(room.left + 6, Math.min(room.right - 6, wanted.x));
  const y = Math.max(room.top + 14, Math.min(room.floor - 2, wanted.y));
  const least = THROW_NEAR / 2;
  // (A pointer held up over her head is fine as it is: she throws it straight up to it.)
  if (!pointer && Math.abs(x - pipX) < least) {
    const side = pipX <= middle ? 1 : -1;
    x = Math.max(room.left + 6, Math.min(room.right - 6, pipX + side * THROW_NEAR));
  }
  return { x, y };
};

/**
 * Where she stands to throw at `targetX`, from where she is (`from`, kept
 * between `min` and `max`): in to `THROW_FAR` if she is farther, out to
 * `THROW_NEAR` if she is on top of it (the way she was already, unless the
 * wall is there), and where she is otherwise.
 */
export const throwSpot = (from: number, targetX: number, min: number, max: number): number => {
  const keep = (x: number) => Math.max(min, Math.min(max, x));
  const gap = from - targetX;
  const side = gap === 0 ? (targetX - min >= max - targetX ? -1 : 1) : Math.sign(gap);
  if (Math.abs(gap) > THROW_FAR) return keep(targetX + side * THROW_FAR);
  if (Math.abs(gap) >= THROW_NEAR) return keep(from);
  const out = keep(targetX + side * THROW_NEAR);
  // Backed against the wall, the other side of it is the nearer place to throw from.
  return Math.abs(out - targetX) >= THROW_NEAR - 1 ? out : keep(targetX - side * THROW_NEAR);
};

// ---- chance, seeded -----------------------------------------------------------------------

/** The next number from a seed (0 to 1), and the seed after it: the same seed, the same game. */
export const draw = (seed: number): { value: number; seed: number } => {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
};

/**
 * A gentle underarm toss to her, from `from`, for the Ball key and a tap on
 * the ball: up and over to her hands, a little different each time (how long
 * it hangs, and how true it is). Says the seed to use next.
 */
export const underarm = (from: { x: number; y: number }, hands: { x: number; y: number }, room: Room, seed: number): { vx: number; vy: number; seed: number } => {
  const hang = draw(seed);
  const stray = draw(hang.seed);
  const to = { x: hands.x + (stray.value - 0.5) * 10, y: hands.y };
  const toss = lob(from, to, room, 0.9 + hang.value * 0.25);
  return { vx: toss.vx, vy: toss.vy, seed: stray.seed };
};

/** Where the Ball key's toss starts from: low, a few steps off to the side of her with more room. Says the seed to use next. */
export const tossFrom = (pipX: number, room: Room, seed: number): { x: number; y: number; seed: number } => {
  const far = draw(seed);
  const side = pipX <= (room.left + room.right) / 2 ? 1 : -1;
  const x = Math.max(room.left + 4, Math.min(room.right - 4, pipX + side * (50 + far.value * 24)));
  return { x, y: room.floor - 5, seed: far.seed };
};

// ---- how she takes it -------------------------------------------------------------------------

/** She can take a ball this far to either side of her, and this far above her feet (floor pixels): above her head, with a jump. */
export const REACH_X = 9;
export const HEAD_HIGH = 24;
export const JUMP_REACH = 38;
/** After the ball at this speed (floor pixels a second); and at this share of it when her heart is not in it. */
export const CATCH_RUN = 96;
export const HALF_PACE = 0.6;

/** Where a ball is, to a Pip whose feet are at `feetY`: out of reach, up where she must jump for it, or in her hands. */
export const reachOf = (ballY: number, feetY: number): "over" | "jump" | "hands" => {
  const up = feetY - ballY;
  return up > JUMP_REACH ? "over" : up > HEAD_HIGH ? "jump" : "hands";
};

/** One time in eleven it bonks her on the head; a little oftener she jumps and misses; and about a quarter of the time she sends it straight back with her head or her foot. */
export const BONK_CHANCE = 0.09;
export const MISS_CHANCE = 0.11;
export const FLOURISH_CHANCE = 0.26;

/**
 * A game under way. `count`: catches in a row, hers and the reader's.
 * `received`: balls that have come her way this game. `fumbled`: her last one
 * went wrong. `unanswered`: throws of hers in a row that nobody caught.
 * `game`: the rally has been long enough to count as a game, and has been
 * counted.
 */
export type Rally = { count: number; seed: number; received: number; fumbled: boolean; unanswered: number; game: boolean };

export const rallyStart = (seed: number): Rally => ({ count: 0, seed: seed | 0, received: 0, fumbled: false, unanswered: 0, game: false });

/** How she takes a ball: a catch, sent straight back (a header or a kick, by how high it is), off her head, or missed. */
export type Receive = "catch" | "flourish" | "bonk" | "miss";

/** A rally this long is a game (pip/temper.ts, `game`); and at these counts she cheers (and every ten after the last). */
export const RALLY_IS_GAME = 4;
export const RALLY_CHEERS: readonly number[] = [5, 10, 20];
/** The count shows beside the ball from here up. */
export const RALLY_SHOWS = 2;

export const cheersAt = (count: number) => RALLY_CHEERS.includes(count) || (count > 20 && count % 10 === 0);

/** What a catch did to the rally: the rally after it, whether it has just become a game, and whether it is one she cheers. */
export type Tally = { rally: Rally; game: boolean; cheer: boolean };

const counted = (rally: Rally): Tally => {
  const count = rally.count + 1;
  const game = !rally.game && count >= RALLY_IS_GAME;
  return { rally: { ...rally, count, game: rally.game || game }, game, cheer: cheersAt(count) };
};

/**
 * The ball has come to her. Mostly she catches it. A fumble (a bonk, a miss)
 * ends the rally, and is never her first of a game nor two running; with her
 * heart not in it (`half`) there are no flourishes; without motion (`still`)
 * she simply has it.
 */
export const receive = (rally: Rally, how: { half?: boolean; still?: boolean } = {}): Tally & { how: Receive } => {
  const chance = draw(rally.seed);
  const next = { ...rally, seed: chance.seed, received: rally.received + 1 };
  const mayFumble = !how.still && !rally.fumbled && rally.received > 0;
  const fumble: Receive | null = chance.value < BONK_CHANCE ? "bonk" : chance.value < BONK_CHANCE + MISS_CHANCE ? "miss" : null;
  if (fumble && mayFumble) return { rally: { ...next, count: 0, fumbled: true, game: false }, game: false, cheer: false, how: fumble };
  const flourish = !fumble && !how.half && !how.still && chance.value < BONK_CHANCE + MISS_CHANCE + FLOURISH_CHANCE;
  return { ...counted({ ...next, fumbled: false }), how: flourish ? "flourish" : "catch" };
};

/** The reader caught hers. */
export const readerCaught = (rally: Rally): Tally => counted({ ...rally, unanswered: 0 });

/** Hers came down with nobody under it: the rally is over, and she has thrown one more for nothing. */
export const readerMissed = (rally: Rally): Rally => ({ ...rally, count: 0, game: false, unanswered: rally.unanswered + 1 });

/** She picked it up off the floor: a fetch, not a catch. The rally starts again from nothing. */
export const fetched = (rally: Rally): Rally => ({ ...rally, count: 0, game: false });

/** The reader has the ball again: whatever she threw for nothing is forgotten. */
export const readerBack = (rally: Rally): Rally => ({ ...rally, unanswered: 0 });

/** How keen she is, 0 to 3, by how long the rally has gone. */
export const keenness = (count: number): 0 | 1 | 2 | 3 => (count >= 10 ? 3 : count >= 6 ? 2 : count >= 3 ? 1 : 0);

/** How long she wiggles before she throws, in milliseconds: shorter the keener she is, and long when her heart is not in it. */
export const WINDUP_MS: readonly number[] = [680, 540, 420, 320];
export const WINDUP_HALF_MS = 1100;
export const windupMs = (count: number, half = false) => (half ? WINDUP_HALF_MS : WINDUP_MS[keenness(count)]);

// ---- asking to play ---------------------------------------------------------------------------
//
// The reader has stopped mid-game. She throws it for nothing at most
// `TRIES` times; after that she waits, and the wait has three stages, each
// done once. Nothing is said, and nothing comes of not answering.

/** Throws of hers in a row that nobody caught, before she stops throwing and waits. */
export const TRIES = 2;
/** The ball has lain this long since anyone touched it: she nudges it over; lies down with her chin on it; puts it away. */
export const ASK_NUDGE_MS = 6000;
export const ASK_CHIN_MS = 22_000;
export const ASK_AWAY_MS = 55_000;
/** A ball nobody is in a state to put away (she is asleep, or will have nothing to do with it) goes by itself after this long. */
export const BALL_FORGOTTEN_MS = 180_000;

export type Ask = "nudge" | "chin" | "away";

/** What the wait has come to, `idleMs` after the ball came to rest: nothing yet, or the stage it has reached. */
export const askStage = (idleMs: number): Ask | null => (idleMs >= ASK_AWAY_MS ? "away" : idleMs >= ASK_CHIN_MS ? "chin" : idleMs >= ASK_NUDGE_MS ? "nudge" : null);

/** What she does about a ball lying on the floor that is hers to do something about. */
export type Turn = "fetch" | "retry" | Ask | "wait";

/**
 * Her turn, with the ball down. Thrown by the reader: she fetches it. Thrown
 * by her and missed: she tries again, `TRIES` times; then the wait (`asked`:
 * how many of its stages she has done). Put down by anyone else's doing
 * (`by` null: she was called away with it): the wait too.
 */
export const turnOf = (state: { by: "reader" | "pip" | null; unanswered: number; idleMs: number; asked: number }): Turn => {
  if (state.by === "reader") return "fetch";
  if (state.by === "pip" && state.unanswered < TRIES) return "retry";
  const stage = askStage(state.idleMs);
  const rank = stage === "away" ? 3 : stage === "chin" ? 2 : stage === "nudge" ? 1 : 0;
  return stage && rank > state.asked ? stage : "wait";
};

// ---- making up ----------------------------------------------------------------------------------
//
// In a huff she will have nothing to do with the ball. But a ball rolled
// gently to her feet is a peace offering, and she takes it as one
// (pip/temper.ts, `offerPeace`): the huff is over, and she pats it back.

/** Let go of no faster than this (floor pixels a second), and come to rest this near her feet, it was rolled to her, not thrown at her. */
export const GENTLE_SPEED = 200;
export const FEET_REACH = 18;

export const peaceOffering = (ballX: number, pipX: number, thrownAt: number) => thrownAt <= GENTLE_SPEED && Math.abs(ballX - pipX) <= FEET_REACH;
