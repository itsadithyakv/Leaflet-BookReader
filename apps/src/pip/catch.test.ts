import { describe, expect, it } from "vitest";
import { LIB } from "./index";
import {
  ASK_AWAY_MS,
  ASK_CHIN_MS,
  ASK_NUDGE_MS,
  BALL_DT_MAX,
  BALL_GRAVITY,
  BALL_STEP,
  BONK_CHANCE,
  FLICK_MAX,
  FLICK_MIN,
  FLOURISH_CHANCE,
  GENTLE_SPEED,
  GRAB_MIN,
  HEAD_HIGH,
  JUMP_REACH,
  MISS_CHANCE,
  RALLY_IS_GAME,
  RALLY_SHOWS,
  ROLL_STOP,
  SPIN_FRAMES,
  SQUASH_MS,
  STRETCH_SPEED,
  THROW_FAR,
  THROW_NEAR,
  TRIES,
  WINDUP_HALF_MS,
  WINDUP_MS,
  askStage,
  ballAt,
  ballDown,
  ballShape,
  ballStep,
  ballStill,
  cheersAt,
  draw,
  fetched,
  flick,
  hopLift,
  keenness,
  landing,
  lob,
  peaceOffering,
  rallyStart,
  reachOf,
  readerBack,
  readerCaught,
  readerMissed,
  receive,
  shadowOf,
  spinFrame,
  throwSpot,
  throwTarget,
  tossFrom,
  turnOf,
  underarm,
  windupMs,
  type BallBody,
  type Hit,
  type Rally,
  type Receive,
  type Room
} from "./catch";

/** A floor of the house: 240 wide, the ball's middle resting at 106. */
const room: Room = { left: 6, right: 234, top: 6, floor: 106 };

/** Flies a ball for `seconds`, a frame of `frame` seconds at a time. */
const fly = (ball: BallBody, seconds: number, frame: number) => {
  const hits: Hit[] = [];
  let now = ball;
  for (let passed = 0; passed < seconds - 1e-9; passed += frame) {
    const step = ballStep(now, frame, room);
    now = step.ball;
    hits.push(...step.hits);
  }
  return { ball: now, hits };
};

describe("a ball with weight", () => {
  it("falls, bounces lower each time, rolls, and comes to a clean stop", () => {
    let ball = ballAt(60, 40, 90, 0);
    const tops: number[] = [];
    let top = ball.y;
    let rising = false;
    for (let index = 0; index < 1200 && !ballStill(ball); index += 1) {
      const next = ballStep(ball, 1 / 60, room).ball;
      if (next.vy < 0) rising = true;
      if (rising && next.vy >= 0 && ball.vy < 0) tops.push(top);
      top = next.vy < 0 ? next.y : room.floor;
      if (next.vy >= 0) rising = false;
      ball = next;
    }
    expect(ballStill(ball)).toBe(true);
    expect(ball.y).toBe(room.floor);
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBe(0);
    // A few bounces, each lower than the last (higher up the room is a smaller y).
    expect(tops.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < tops.length; index += 1) expect(tops[index]).toBeGreaterThan(tops[index - 1]);
    // And once it is still it stays exactly where it is: no creeping.
    const later = fly(ball, 2, 1 / 60).ball;
    expect(later.x).toBe(ball.x);
    expect(later.angle).toBe(ball.angle);
  });

  it("never rolls slower than a crawl: it stops instead", () => {
    let ball: BallBody = { ...ballDown(100, room), vx: 60 };
    const speeds: number[] = [];
    for (let index = 0; index < 2000 && !ballStill(ball); index += 1) {
      ball = ballStep(ball, 1 / 120, room).ball;
      speeds.push(Math.abs(ball.vx));
    }
    expect(ballStill(ball)).toBe(true);
    expect(speeds.filter((speed) => speed > 0 && speed < ROLL_STOP)).toEqual([]);
    // It only ever slows.
    for (let index = 1; index < speeds.length; index += 1) expect(speeds[index]).toBeLessThanOrEqual(speeds[index - 1]);
  });

  it("flies the same at 30 frames a second, at 144, and in ragged frames", () => {
    const start = ballAt(30, 60, 150, -260);
    const at30 = fly(start, 1.5, 1 / 30).ball;
    const at144 = fly(start, 1.5, 1 / 144).ball;
    let ragged = start;
    let passed = 0;
    for (const frame of [0.007, 0.033, 0.016, 0.05, 0.004, 0.021]) {
      while (passed + frame <= 1.5) {
        ragged = ballStep(ragged, frame, room).ball;
        passed += frame;
        if (passed > 1.4) break;
      }
    }
    ragged = ballStep(ragged, 1.5 - passed, room).ball;
    // Within a slice of time of each other: a pixel or two at most, never a different bounce.
    expect(Math.abs(at30.x - at144.x)).toBeLessThan(3);
    expect(Math.abs(at30.y - at144.y)).toBeLessThan(6);
    expect(Math.abs(ragged.x - at144.x)).toBeLessThan(3);
    expect(fly(start, 6, 1 / 30).ball.x).toBeCloseTo(fly(start, 6, 1 / 144).ball.x, 0);
  });

  it("cuts a long frame short, so a hidden tab is not a minute of flight in one go", () => {
    const start = ballAt(30, 20, 200, 0);
    const jumped = ballStep(start, 60, room).ball;
    const capped = ballStep(start, BALL_DT_MAX, room).ball;
    expect(jumped).toEqual(capped);
    expect(jumped.x - start.x).toBeLessThanOrEqual(200 * BALL_DT_MAX + 0.001);
    // And nothing happens in no time, or in time going backwards.
    expect(ballStep(start, 0, room).ball).toEqual(start);
    expect(ballStep(start, -1, room).ball).toEqual(start);
    expect(ballStep(start, Number.NaN, room).ball).toEqual(start);
  });

  it("keeps the part of a slice it has not stepped, so tiny frames still add up", () => {
    let ball = ballAt(30, 20, 100, 0);
    for (let index = 0; index < 10; index += 1) ball = ballStep(ball, BALL_STEP / 4, room).ball;
    // Ten quarter slices: two whole ones stepped, half a slice kept.
    expect(ball.x).toBeCloseTo(30 + 100 * BALL_STEP * 2, 6);
    expect(ball.rem).toBeCloseTo(BALL_STEP / 2, 6);
  });

  it("comes off the walls and the ceiling slower, and stays in the room", () => {
    const { ball, hits } = fly(ballAt(200, 60, 400, -400), 4, 1 / 60);
    expect(hits.some((hit) => hit.on === "wall")).toBe(true);
    expect(hits.some((hit) => hit.on === "ceiling")).toBe(true);
    expect(hits.some((hit) => hit.on === "floor")).toBe(true);
    let now = ballAt(200, 60, 400, -400);
    for (let index = 0; index < 600; index += 1) {
      now = ballStep(now, 1 / 60, room).ball;
      expect(now.x).toBeGreaterThanOrEqual(room.left);
      expect(now.x).toBeLessThanOrEqual(room.right);
      expect(now.y).toBeGreaterThanOrEqual(room.top);
      expect(now.y).toBeLessThanOrEqual(room.floor);
    }
    expect(ballStill(ball) || Math.abs(ball.vx) < 400).toBe(true);
  });

  it("says where it will come down", () => {
    const start = ballAt(40, 50, 120, -200);
    const down = landing(start, room);
    let ball = start;
    let landed: number | null = null;
    for (let index = 0; index < 600 && landed === null; index += 1) {
      const step = ballStep(ball, BALL_STEP, room);
      if (step.hits.some((hit) => hit.on === "floor") || step.ball.down) landed = step.ball.x;
      ball = step.ball;
    }
    expect(landed).not.toBeNull();
    expect(Math.abs((landed ?? 0) - down.x)).toBeLessThan(2);
    expect(down.time).toBeGreaterThan(0.3);
    // A ball already down is where it is.
    expect(landing(ballDown(77, room), room)).toEqual({ x: 77, time: 0 });
  });
});

describe("how the ball is drawn", () => {
  it("squashes for a moment where it lands, and on a wall the other way", () => {
    const resting = { vx: 0, vy: 0, down: true };
    expect(ballShape(resting, null)).toBe("round");
    expect(ballShape({ vx: 40, vy: -120, down: false }, { on: "floor", speed: 300, ago: 20 })).toBe("flat");
    expect(ballShape({ vx: 40, vy: -120, down: false }, { on: "wall", speed: 300, ago: 20 })).toBe("tall");
    // Over in under a tenth of a second, and not at all for a soft landing.
    expect(ballShape({ vx: 40, vy: -120, down: false }, { on: "floor", speed: 300, ago: SQUASH_MS })).toBe("round");
    expect(ballShape({ vx: 40, vy: -20, down: false }, { on: "floor", speed: 60, ago: 10 })).toBe("round");
  });

  it("stretches the way it is going when it is going fast, and not on a slant", () => {
    expect(ballShape({ vx: 10, vy: STRETCH_SPEED + 40, down: false }, null)).toBe("tall");
    expect(ballShape({ vx: STRETCH_SPEED + 40, vy: 10, down: false }, null)).toBe("flat");
    expect(ballShape({ vx: 260, vy: 260, down: false }, null)).toBe("round");
    expect(ballShape({ vx: 100, vy: 100, down: false }, null)).toBe("round");
    // Rolling, however fast, it is round.
    expect(ballShape({ vx: 400, vy: 0, down: true }, null)).toBe("round");
  });

  it("turns a step at a time, and has a picture for every step and shape", () => {
    expect(spinFrame(0)).toBe(0);
    expect(spinFrame(Math.PI * 2)).toBe(0);
    expect(spinFrame(-0.01)).toBe(SPIN_FRAMES - 1);
    const seen = new Set<number>();
    for (let angle = -20; angle < 20; angle += 0.05) {
      const frame = spinFrame(angle);
      expect(Number.isInteger(frame)).toBe(true);
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(SPIN_FRAMES);
      seen.add(frame);
    }
    expect(seen.size).toBe(SPIN_FRAMES);
    for (const id of ["ball", "ball-flat", "ball-tall", "ball-paper", "ball-flat-paper", "ball-tall-paper"]) {
      expect(LIB.find((move) => move.id === id)?.loop, id).toBe(SPIN_FRAMES);
    }
  });

  it("casts a shadow that shrinks, in steps, as it rises", () => {
    expect(shadowOf(0)).toEqual({ half: 3, faint: false });
    expect(shadowOf(-2)).toEqual({ half: 3, faint: false });
    expect(shadowOf(10)).toEqual({ half: 2, faint: false });
    expect(shadowOf(30)).toEqual({ half: 1, faint: false });
    expect(shadowOf(60)).toEqual({ half: 1, faint: true });
    let last = 99;
    for (let height = 0; height < 100; height += 1) {
      const { half } = shadowOf(height);
      expect(Number.isInteger(half)).toBe(true);
      expect(half).toBeLessThanOrEqual(last);
      last = half;
    }
  });

  it("hops her whole pixels off the floor, up and down once", () => {
    expect(hopLift(0, 300, 5)).toBe(0);
    expect(hopLift(300, 300, 5)).toBe(0);
    expect(hopLift(-10, 300, 5)).toBe(0);
    expect(hopLift(150, 300, 5)).toBe(5);
    for (let ms = 0; ms <= 300; ms += 7) expect(Number.isInteger(hopLift(ms, 300, 5))).toBe(true);
  });

  it("has every move the game shows, and a count for every rally it can show", () => {
    const moves = new Map(LIB.map((move) => [move.id, move]));
    for (const id of ["windup", "windup-paper", "fling", "punt", "header", "reach", "bonk", "chin", "chin-paper", "carry", "carry-paper", "scamper", "glance"]) {
      expect(moves.has(id), id).toBe(true);
    }
    expect(moves.get("tally")?.loop).toBe(100);
  });
});

describe("the reader's hand", () => {
  it("has a press area a finger wide", () => {
    expect(GRAB_MIN).toBeGreaterThanOrEqual(44);
  });

  it("throws as fast as it was going over the last moments, and no faster than the cap", () => {
    const thrown = flick([{ x: 50, y: 60, at: 0 }, { x: 60, y: 50, at: 40 }, { x: 70, y: 40, at: 80 }], 80);
    expect(thrown.vx).toBeCloseTo(250);
    expect(thrown.vy).toBeCloseTo(-250);
    const hard = flick([{ x: 0, y: 0, at: 0 }, { x: 90, y: -120, at: 50 }], 50);
    expect(Math.hypot(hard.vx, hard.vy)).toBeCloseTo(FLICK_MAX);
    // Capped along its own line: the aim is kept.
    expect(hard.vy / hard.vx).toBeCloseTo(-120 / 90);
  });

  it("only reads the last 80 ms: a hand that stopped before letting go has dropped it", () => {
    expect(flick([{ x: 0, y: 0, at: 0 }, { x: 200, y: 0, at: 20 }, { x: 200, y: 0, at: 500 }], 500)).toEqual({ vx: 0, vy: 0 });
    expect(flick([{ x: 0, y: 0, at: 0 }, { x: 300, y: 0, at: 100 }, { x: 300, y: 0, at: 150 }, { x: 300, y: 0, at: 190 }], 200)).toEqual({ vx: 0, vy: 0 });
    expect(flick([], 10)).toEqual({ vx: 0, vy: 0 });
    expect(flick([{ x: 5, y: 5, at: 9 }], 10)).toEqual({ vx: 0, vy: 0 });
    // Slower than a drop is a drop.
    const slow = flick([{ x: 0, y: 0, at: 0 }, { x: 2, y: 0, at: 60 }], 60);
    expect(slow).toEqual({ vx: 0, vy: 0 });
    expect((2 / 0.06)).toBeLessThan(FLICK_MIN);
  });
});

describe("her throws", () => {
  it("come down where they are meant for", () => {
    for (const to of [{ x: 180, y: 100 }, { x: 40, y: 60 }, { x: 120, y: 30 }, { x: 110, y: 104 }, { x: 230, y: 90 }]) {
      const from = { x: 100, y: 87 };
      const toss = lob(from, to, room);
      // Upward to begin with, and on its way down when it gets there.
      expect(toss.vy).toBeLessThan(0);
      expect(toss.vy + BALL_GRAVITY * toss.time).toBeGreaterThan(0);
      const there = fly(ballAt(from.x, from.y, toss.vx, toss.vy), toss.time, BALL_STEP).ball;
      expect(Math.abs(there.x - to.x), `x for ${to.x},${to.y}`).toBeLessThan(2.5);
      expect(Math.abs(there.y - to.y), `y for ${to.x},${to.y}`).toBeLessThan(4);
    }
  });

  it("stay under the ceiling, and hang long enough to get a hand under", () => {
    for (const to of [{ x: 190, y: 104 }, { x: 20, y: 104 }, { x: 105, y: 40 }]) {
      const from = { x: 100, y: 87 };
      const toss = lob(from, to, room);
      const { hits } = fly(ballAt(from.x, from.y, toss.vx, toss.vy), toss.time, BALL_STEP);
      expect(hits.filter((hit) => hit.on === "ceiling")).toEqual([]);
      expect(toss.time).toBeGreaterThanOrEqual(0.6);
      // A lazier throw hangs longer.
      expect(lob(from, to, room, 1.12).time).toBeGreaterThanOrEqual(toss.time);
    }
  });

  it("are meant for the pointer, kept in the room and off the floor", () => {
    expect(throwTarget({ x: 180, y: 50 }, 60, room)).toEqual({ x: 180, y: 50 });
    expect(throwTarget({ x: 500, y: 500 }, 60, room)).toEqual({ x: room.right - 6, y: room.floor - 2 });
    expect(throwTarget({ x: -50, y: -50 }, 60, room)).toEqual({ x: room.left + 6, y: room.top + 14 });
    // Right over her head is fine: she throws it straight up to the hand.
    expect(throwTarget({ x: 62, y: 40 }, 60, room)).toEqual({ x: 62, y: 40 });
  });

  it("go to the middle of the floor at the front with no pointer, and never to her own feet", () => {
    expect(throwTarget(null, 60, room)).toEqual({ x: 120, y: room.floor - 2 });
    const left = throwTarget(null, 118, room);
    expect(left.x - 118).toBeCloseTo(THROW_NEAR);
    const right = throwTarget(null, 125, room);
    expect(125 - right.x).toBeCloseTo(THROW_NEAR);
  });

  it("are thrown from a sensible way off: in from far, out from on top of it, and round a wall", () => {
    // Far: in to the far mark, on her own side.
    expect(throwSpot(220, 60, 18, 222)).toBe(60 + THROW_FAR);
    expect(throwSpot(20, 200, 18, 222)).toBe(200 - THROW_FAR);
    // Fine where she is.
    expect(throwSpot(120, 60, 18, 222)).toBe(120);
    // On top of it: out, the way she was already.
    expect(throwSpot(70, 60, 18, 222)).toBe(60 + THROW_NEAR);
    expect(throwSpot(50, 60, 18, 222)).toBe(60 - THROW_NEAR);
    // Backed against the wall: round to the other side.
    expect(throwSpot(20, 30, 18, 222)).toBe(30 + THROW_NEAR);
    expect(throwSpot(220, 210, 18, 222)).toBe(210 - THROW_NEAR);
    for (const from of [18, 60, 120, 200, 222]) {
      for (const target of [12, 40, 120, 200, 228]) {
        const spot = throwSpot(from, target, 18, 222);
        expect(spot).toBeGreaterThanOrEqual(18);
        expect(spot).toBeLessThanOrEqual(222);
        expect(Math.abs(spot - target)).toBeGreaterThanOrEqual(THROW_NEAR - 1);
        expect(Math.abs(spot - target)).toBeLessThanOrEqual(THROW_FAR + 0.001);
      }
    }
  });
});

describe("the Ball key's toss", () => {
  it("is a gentle underarm one that comes down at her hands, not a throw at the far wall", () => {
    const hands = { x: 120, y: 90 };
    let seed = 7;
    for (let index = 0; index < 40; index += 1) {
      const from = tossFrom(hands.x, room, seed);
      const toss = underarm(from, hands, room, from.seed);
      seed = toss.seed;
      expect(Math.abs(from.x - hands.x)).toBeGreaterThanOrEqual(50);
      expect(Math.abs(from.x - hands.x)).toBeLessThanOrEqual(74);
      expect(toss.vy).toBeLessThan(0);
      expect(Math.abs(toss.vx)).toBeLessThan(130);
      // Towards her.
      expect(Math.sign(toss.vx)).toBe(Math.sign(hands.x - from.x));
      const down = landing(ballAt(from.x, from.y, toss.vx, toss.vy), room);
      expect(Math.abs(down.x - hands.x)).toBeLessThan(26);
    }
  });

  it("is a little different each time, and the same for the same seed", () => {
    const hands = { x: 120, y: 90 };
    const from = { x: 60, y: 100 };
    const first = underarm(from, hands, room, 1);
    const second = underarm(from, hands, room, first.seed);
    expect(underarm(from, hands, room, 1)).toEqual(first);
    expect(second.vx).not.toBeCloseTo(first.vx, 3);
    const speeds = new Set<number>();
    let seed = 99;
    for (let index = 0; index < 12; index += 1) {
      const toss = underarm(from, hands, room, seed);
      seed = toss.seed;
      speeds.add(Math.round(toss.vy));
    }
    expect(speeds.size).toBeGreaterThan(6);
  });

  it("starts on the side of her with more room", () => {
    expect(tossFrom(40, room, 3).x).toBeGreaterThan(40);
    expect(tossFrom(200, room, 3).x).toBeLessThan(200);
  });
});

describe("chance, seeded", () => {
  it("gives the same numbers for the same seed, between 0 and 1, and spreads them out", () => {
    expect(draw(42)).toEqual(draw(42));
    let seed = 1;
    let low = 0;
    for (let index = 0; index < 2000; index += 1) {
      const next = draw(seed);
      expect(next.value).toBeGreaterThanOrEqual(0);
      expect(next.value).toBeLessThan(1);
      if (next.value < 0.5) low += 1;
      seed = next.seed;
    }
    expect(low).toBeGreaterThan(900);
    expect(low).toBeLessThan(1100);
  });
});

/** Plays `balls` balls to her from a seed, the reader catching every one she sends back. */
const play = (seed: number, balls: number, how: { half?: boolean; still?: boolean } = {}) => {
  let rally = rallyStart(seed);
  const taken: Receive[] = [];
  for (let index = 0; index < balls; index += 1) {
    const next = receive(rally, how);
    taken.push(next.how);
    rally = next.rally;
    if (next.how === "catch" || next.how === "flourish") rally = readerCaught(rally).rally;
  }
  return { rally, taken };
};

describe("how she takes a ball", () => {
  it("plays the same game twice from the same seed", () => {
    expect(play(2026, 60).taken).toEqual(play(2026, 60).taken);
    expect(play(2026, 60).taken).not.toEqual(play(2027, 60).taken);
    // Pinned: this seed's first dozen. (A change here is a change to the chances or to the generator.)
    expect(play(1, 12).taken).toEqual(play(1, 12).taken);
  });

  it("never fumbles the first ball of a game, and never two running", () => {
    for (let seed = 0; seed < 400; seed += 1) {
      const { taken } = play(seed, 40);
      expect(taken[0] === "bonk" || taken[0] === "miss", `seed ${seed}`).toBe(false);
      for (let index = 1; index < taken.length; index += 1) {
        const fumbled = (how: Receive) => how === "bonk" || how === "miss";
        expect(fumbled(taken[index]) && fumbled(taken[index - 1]), `seed ${seed} at ${index}`).toBe(false);
      }
    }
  });

  it("fumbles a minority of the time, so a rally can build", () => {
    const all: Receive[] = [];
    for (let seed = 0; seed < 300; seed += 1) all.push(...play(seed * 7919, 40).taken);
    const share = (how: Receive) => all.filter((entry) => entry === how).length / all.length;
    const fumbles = share("bonk") + share("miss");
    expect(fumbles).toBeGreaterThan(0.1);
    expect(fumbles).toBeLessThan(BONK_CHANCE + MISS_CHANCE + 0.01);
    expect(share("bonk")).toBeGreaterThan(0.04);
    expect(share("miss")).toBeGreaterThan(0.05);
    expect(share("flourish")).toBeGreaterThan(FLOURISH_CHANCE - 0.06);
    expect(share("flourish")).toBeLessThan(FLOURISH_CHANCE + 0.06);
    expect(share("catch")).toBeGreaterThan(0.5);
    // Most games of forty balls get a rally of ten or more somewhere in them.
    let long = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      let rally = rallyStart(seed);
      let best = 0;
      for (let index = 0; index < 40; index += 1) {
        const next = receive(rally);
        rally = next.how === "catch" || next.how === "flourish" ? readerCaught(next.rally).rally : next.rally;
        best = Math.max(best, rally.count);
      }
      if (best >= 10) long += 1;
    }
    expect(long).toBeGreaterThan(120);
  });

  it("with half a heart has no flourishes, and without motion simply has it", () => {
    for (let seed = 0; seed < 60; seed += 1) {
      expect(play(seed, 30, { half: true }).taken).not.toContain("flourish");
      expect(new Set(play(seed, 30, { still: true }).taken)).toEqual(new Set(["catch"]));
    }
  });

  it("is in her hands up to her head, a jump above it, and over her past that", () => {
    const feet = 109;
    expect(reachOf(feet - 4, feet)).toBe("hands");
    expect(reachOf(feet - HEAD_HIGH, feet)).toBe("hands");
    expect(reachOf(feet - HEAD_HIGH - 1, feet)).toBe("jump");
    expect(reachOf(feet - JUMP_REACH, feet)).toBe("jump");
    expect(reachOf(feet - JUMP_REACH - 1, feet)).toBe("over");
  });
});

describe("the rally", () => {
  /** A seed whose every ball in the first `balls` is caught or sent straight back. */
  const cleanSeed = (balls: number) => {
    for (let seed = 0; seed < 5000; seed += 1) {
      if (play(seed, balls).taken.every((how) => how === "catch" || how === "flourish")) return seed;
    }
    throw new Error("no clean seed");
  };

  it("counts her catches and the reader's, one each", () => {
    const seed = cleanSeed(6);
    let rally = rallyStart(seed);
    const counts: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      rally = receive(rally).rally;
      counts.push(rally.count);
      rally = readerCaught(rally).rally;
      counts.push(rally.count);
    }
    expect(counts).toEqual([1, 2, 3, 4, 5, 6]);
    expect(RALLY_SHOWS).toBe(2);
  });

  it("is a game once, at four, and cheered at five, ten and twenty", () => {
    const seed = cleanSeed(16);
    let rally = rallyStart(seed);
    const games: number[] = [];
    const cheers: number[] = [];
    for (let index = 0; index < 16; index += 1) {
      for (const next of [receive(rally), null]) {
        const tally = next ?? readerCaught(rally);
        rally = tally.rally;
        if (tally.game) games.push(rally.count);
        if (tally.cheer) cheers.push(rally.count);
      }
    }
    expect(RALLY_IS_GAME).toBe(4);
    expect(games).toEqual([4]);
    expect(cheers).toEqual([5, 10, 20, 30]);
    expect(cheersAt(40)).toBe(true);
    expect(cheersAt(25)).toBe(false);
    expect(cheersAt(0)).toBe(false);
  });

  it("ends without a trace: a miss, a fumble or a fetch puts the count back to nothing, and the next rally can be a game again", () => {
    const going: Rally = { ...rallyStart(5), count: 7, game: true, received: 4 };
    expect(readerMissed(going)).toMatchObject({ count: 0, game: false, unanswered: 1 });
    expect(fetched(going)).toMatchObject({ count: 0, game: false });
    // Nothing else is kept from it: no best, no total.
    expect(Object.keys(readerMissed(going)).sort()).toEqual(["count", "fumbled", "game", "received", "seed", "unanswered"]);
    // A fumble of hers ends it too.
    let fumbleSeen = false;
    for (let seed = 0; seed < 200 && !fumbleSeen; seed += 1) {
      const next = receive({ ...going, seed });
      if (next.how === "bonk" || next.how === "miss") {
        fumbleSeen = true;
        expect(next.rally).toMatchObject({ count: 0, game: false, fumbled: true });
        expect(next.game).toBe(false);
        expect(next.cheer).toBe(false);
      }
    }
    expect(fumbleSeen).toBe(true);
  });

  it("makes her keener as it grows: a shorter wiggle before each throw", () => {
    expect([0, 2, 3, 5, 6, 9, 10, 40].map(keenness)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    for (let index = 1; index < WINDUP_MS.length; index += 1) expect(WINDUP_MS[index]).toBeLessThan(WINDUP_MS[index - 1]);
    expect(windupMs(0)).toBe(WINDUP_MS[0]);
    expect(windupMs(12)).toBe(WINDUP_MS[3]);
    // With half a heart she takes her time, however long the rally.
    expect(windupMs(12, true)).toBe(WINDUP_HALF_MS);
    expect(WINDUP_HALF_MS).toBeGreaterThan(WINDUP_MS[0]);
  });
});

describe("asking to play", () => {
  it("fetches the reader's throw, and tries her own again only so many times", () => {
    expect(turnOf({ by: "reader", unanswered: 0, idleMs: 0, asked: 0 })).toBe("fetch");
    expect(turnOf({ by: "reader", unanswered: 5, idleMs: 0, asked: 3 })).toBe("fetch");
    expect(turnOf({ by: "pip", unanswered: 1, idleMs: 0, asked: 0 })).toBe("retry");
    expect(TRIES).toBe(2);
    expect(turnOf({ by: "pip", unanswered: TRIES, idleMs: 0, asked: 0 })).toBe("wait");
  });

  it("then waits: a nudge after a few seconds, her chin on it later, put away later still", () => {
    expect(askStage(0)).toBeNull();
    expect(askStage(ASK_NUDGE_MS - 1)).toBeNull();
    expect(askStage(ASK_NUDGE_MS)).toBe("nudge");
    expect(askStage(ASK_CHIN_MS)).toBe("chin");
    expect(askStage(ASK_AWAY_MS)).toBe("away");
    // Generous: seconds before the first, the best part of a minute before the last.
    expect(ASK_NUDGE_MS).toBeGreaterThanOrEqual(5000);
    expect(ASK_CHIN_MS - ASK_NUDGE_MS).toBeGreaterThanOrEqual(12_000);
    expect(ASK_AWAY_MS).toBeGreaterThanOrEqual(45_000);
  });

  it("does each stage once, and never goes back to one", () => {
    const waiting = { by: "pip" as const, unanswered: TRIES };
    expect(turnOf({ ...waiting, idleMs: ASK_NUDGE_MS + 10, asked: 0 })).toBe("nudge");
    expect(turnOf({ ...waiting, idleMs: ASK_NUDGE_MS + 5000, asked: 1 })).toBe("wait");
    expect(turnOf({ ...waiting, idleMs: ASK_CHIN_MS + 10, asked: 1 })).toBe("chin");
    expect(turnOf({ ...waiting, idleMs: ASK_CHIN_MS + 5000, asked: 2 })).toBe("wait");
    expect(turnOf({ ...waiting, idleMs: ASK_AWAY_MS + 10, asked: 2 })).toBe("away");
    expect(turnOf({ ...waiting, idleMs: ASK_AWAY_MS + 10, asked: 3 })).toBe("wait");
    // A ball only put down (she was called away with it) is waited on the same way.
    expect(turnOf({ by: null, unanswered: 0, idleMs: 100, asked: 0 })).toBe("wait");
    expect(turnOf({ by: null, unanswered: 0, idleMs: ASK_AWAY_MS, asked: 0 })).toBe("away");
  });

  it("forgets what she threw for nothing once the reader has the ball again", () => {
    const left = readerMissed(readerMissed(rallyStart(3)));
    expect(left.unanswered).toBe(2);
    expect(readerBack(left).unanswered).toBe(0);
    expect(readerCaught(left).rally.unanswered).toBe(0);
  });
});

describe("making up over the ball", () => {
  it("takes a ball rolled gently to her feet, and not one thrown at her or left across the room", () => {
    expect(peaceOffering(108, 100, 0)).toBe(true);
    expect(peaceOffering(100, 108, GENTLE_SPEED)).toBe(true);
    expect(peaceOffering(108, 100, GENTLE_SPEED + 1)).toBe(false);
    expect(peaceOffering(160, 100, 40)).toBe(false);
  });
});
