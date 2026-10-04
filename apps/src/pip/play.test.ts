import { describe, expect, it } from "vitest";
import {
  HARD_LANDING,
  HOLD_REACH,
  PIP_BOUNCE,
  PLAY_EVERY_MS,
  POKE_CALM_MS,
  POKE_RUNGS,
  TOSS_MAX,
  caught,
  flyStep,
  holdMove,
  holdStart,
  holdStep,
  isToss,
  letGo,
  nearUpright,
  playCounts,
  pokeAgain,
  pokeReaction,
  releaseVelocity,
  rollStep,
  strokeMove,
  strokeStart,
  swingStep,
  type Body,
  type Hold,
  type Poke,
  type Touch
} from "./play";

describe("poking Pip", () => {
  it("answers each poke in a row differently, then surprises", () => {
    let poke: Poke | null = null;
    const answers: string[] = [];
    for (let index = 0; index < POKE_RUNGS; index += 1) {
      poke = pokeAgain(poke, index * 800);
      const reaction = pokeReaction(poke.count);
      expect(reaction.surprise).toBeUndefined();
      answers.push(`${reaction.move}|${reaction.line}|${reaction.pitch}`);
    }
    expect(new Set(answers).size).toBe(POKE_RUNGS);
    expect(pokeReaction(pokeAgain(poke, POKE_RUNGS * 800).count).surprise).toBe(true);
  });

  it("starts with a startle, at once", () => {
    expect(pokeReaction(1)).toMatchObject({ move: "boop", loops: 1, sound: "squeak" });
  });

  it("forgets once she is left alone", () => {
    const third = pokeAgain(pokeAgain(pokeAgain(null, 0), 500), 1000);
    expect(third.count).toBe(3);
    expect(pokeAgain(third, 1000 + POKE_CALM_MS - 1).count).toBe(4);
    expect(pokeAgain(third, 1000 + POKE_CALM_MS).count).toBe(1);
  });
});

describe("stroking and tickling", () => {
  /** The pointer swept left and right across her, `period` ms a sweep. */
  const rub = (sweeps: number, period: number, width = 20) => {
    let stroke = strokeStart(0);
    let touch: Touch = "none";
    let now = 0;
    for (let sweep = 0; sweep < sweeps; sweep += 1) {
      for (let step = 1; step <= 5; step += 1) {
        now += period / 5;
        const x = sweep % 2 === 0 ? (width * step) / 5 : width - (width * step) / 5;
        ({ stroke, touch } = strokeMove(stroke, x, now, 64));
      }
    }
    return touch;
  };

  it("is not a stroke when the pointer only passes over", () => {
    expect(rub(1, 300)).toBe("none");
    expect(rub(2, 300)).toBe("none");
  });

  it("is petting when the pointer rubs back and forth", () => {
    expect(rub(3, 350)).toBe("pet");
    expect(rub(4, 400)).toBe("pet");
  });

  it("is tickling when it rubs fast", () => {
    expect(rub(8, 110)).toBe("tickle");
  });

  it("is not a tickle when the hand only trembles", () => {
    expect(rub(12, 60, 3)).toBe("none");
  });

  it("fades once the rubbing stops", () => {
    let stroke = strokeStart(0);
    let touch: Touch = "none";
    for (const [x, at] of [[20, 100], [0, 200], [20, 300], [0, 400]] as const) ({ stroke, touch } = strokeMove(stroke, x, at, 64));
    expect(touch).toBe("pet");
    ({ touch } = strokeMove(stroke, 0, 2500, 64));
    expect(touch).toBe("none");
  });
});

describe("held by the leaf", () => {
  it("hangs still under a still hand, and settles there from a swing", () => {
    expect(swingStep({ angle: 0, spin: 0 }, 0, 0.016)).toEqual({ angle: 0, spin: 0 });
    let swing = { angle: 1, spin: 0 };
    for (let index = 0; index < 600; index += 1) swing = swingStep(swing, 0, 0.016);
    expect(Math.abs(swing.angle)).toBeLessThan(0.01);
    expect(Math.abs(swing.spin)).toBeLessThan(0.05);
  });

  it("swings when the hand flicks, and never right over", () => {
    let swing = { angle: 0, spin: 0 };
    let widest = 0;
    for (let index = 0; index < 400; index += 1) {
      swing = swingStep(swing, index % 40 < 20 ? 1400 : -1400, 0.016);
      widest = Math.max(widest, Math.abs(swing.angle));
      expect(Number.isFinite(swing.angle)).toBe(true);
    }
    expect(widest).toBeGreaterThan(0.3);
    expect(widest).toBeLessThanOrEqual(2.2);
  });
});

describe("let go", () => {
  const bounds = { left: 10, right: 230, top: 20, floor: 109 };

  it("is a drop from a still hand and a toss from a moving one", () => {
    const still = releaseVelocity([{ x: 50, y: 50, at: 0 }, { x: 50, y: 50, at: 80 }], 80);
    expect(isToss(still)).toBe(false);
    const flick = releaseVelocity([{ x: 50, y: 60, at: 0 }, { x: 70, y: 40, at: 80 }], 80);
    expect(flick.vx).toBeCloseTo(250);
    expect(flick.vy).toBeCloseTo(-250);
    expect(isToss(flick)).toBe(true);
  });

  it("ignores where the hand was long ago, and caps a wild fling", () => {
    expect(releaseVelocity([{ x: 0, y: 0, at: 0 }, { x: 200, y: 0, at: 20 }, { x: 200, y: 0, at: 500 }], 500)).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity([{ x: 0, y: 0, at: 0 }, { x: 400, y: 0, at: 50 }], 50).vx).toBe(TOSS_MAX);
  });

  it("flies in an arc, stays in the room, and lands on the floor", () => {
    let body: Body = { x: 120, y: 60, vx: 380, vy: -300, angle: 0, spin: 6 };
    let landed = false;
    let hits = 0;
    let impact = 0;
    for (let index = 0; index < 600 && !landed; index += 1) {
      const next = flyStep(body, 0.016, bounds);
      body = next.body;
      landed = next.landed;
      impact = next.impact;
      if (next.hit) hits += 1;
      expect(body.x).toBeGreaterThanOrEqual(bounds.left);
      expect(body.x).toBeLessThanOrEqual(bounds.right);
      expect(body.y).toBeGreaterThanOrEqual(bounds.top);
      expect(body.y).toBeLessThanOrEqual(bounds.floor);
    }
    expect(landed).toBe(true);
    expect(body.y).toBe(bounds.floor);
    expect(hits).toBeGreaterThan(0);
    expect(impact).toBeGreaterThan(HARD_LANDING);
  });

  it("lands softly from a small drop", () => {
    let body: Body = { x: 120, y: 95, vx: 0, vy: 0, angle: 0, spin: 0 };
    let result = flyStep(body, 0.016, bounds);
    while (!result.landed) {
      body = result.body;
      result = flyStep(body, 0.016, bounds);
    }
    expect(result.impact).toBeLessThan(HARD_LANDING);
  });

  it("bounces a ball lower each time until it rolls to a stop", () => {
    let body: Body = { x: 60, y: 40, vx: 120, vy: 0, angle: 0, spin: 0 };
    const peaks: number[] = [];
    let top = bounds.floor;
    let landed = false;
    for (let index = 0; index < 2000 && !landed; index += 1) {
      const next = flyStep(body, 0.016, bounds, 0.55);
      top = Math.min(top, next.body.y);
      if (next.hit && next.body.y === bounds.floor) {
        peaks.push(top);
        top = bounds.floor;
      }
      body = next.body;
      landed = next.landed;
    }
    expect(landed).toBe(true);
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    // Each bounce peaks lower (a larger y) than the one before.
    for (let index = 2; index < peaks.length; index += 1) expect(peaks[index]).toBeGreaterThanOrEqual(peaks[index - 1]);
    let still = false;
    for (let index = 0; index < 2000 && !still; index += 1) ({ body, still } = rollStep(body, 0.016, bounds));
    expect(still).toBe(true);
    expect(body.vx).toBe(0);
    expect(body.x).toBeGreaterThanOrEqual(bounds.left);
    expect(body.x).toBeLessThanOrEqual(bounds.right);
  });
});

describe("carried about", () => {
  /** The hand moves sideways at `speed` for `ms`, a move a frame, then holds still for `rest` ms. */
  const carry = (speed: number, ms: number, rest: number, frame = 16) => {
    let hold: Hold = holdStart();
    let x = 100;
    let at = 0;
    const seen: Hold[] = [];
    for (let t = 0; t < ms + rest; t += frame) {
      if (t < ms) {
        const before = { x, y: 60, at };
        x += (speed * frame) / 1000;
        at += frame;
        hold = holdMove(hold, before, { x, y: 60, at });
      }
      hold = holdStep(hold, frame / 1000);
      seen.push(hold);
    }
    return seen;
  };

  it("never freezes: she swings behind a hand that sets off, and on past one that stops", () => {
    const seen = carry(200, 400, 5600);
    const moving = seen.slice(0, 25);
    // The hand sets off to the right: she lags to the left of it (a positive, clockwise turn).
    expect(Math.max(...moving.map((hold) => hold.swing.angle))).toBeGreaterThan(0.1);
    // The hand stops: she swings on past it, the other way.
    const after = seen.slice(25, 60);
    expect(Math.min(...after.map((hold) => hold.swing.angle))).toBeLessThan(-0.1);
    // And settles under it.
    const last = seen[seen.length - 1];
    expect(Math.abs(last.swing.angle)).toBeLessThan(0.02);
    expect(Math.abs(last.swing.spin)).toBeLessThan(0.1);
    expect(Math.abs(last.handVx)).toBeLessThan(0.01);
  });

  it("swings the same at any frame rate, near enough", () => {
    const widest = (frame: number) => Math.max(...carry(200, 400, 600, frame).map((hold) => Math.abs(hold.swing.angle)));
    expect(Math.abs(widest(7) - widest(16))).toBeLessThan(0.15);
    expect(Math.abs(widest(40) - widest(16))).toBeLessThan(0.25);
  });

  it("is carried without a swing when motion is reduced", () => {
    let hold = holdMove(holdStart(), { x: 0, y: 0, at: 0 }, { x: 40, y: 0, at: 16 });
    for (let index = 0; index < 30; index += 1) hold = holdStep(hold, 0.016, true);
    expect(hold.swing).toEqual({ angle: 0, spin: 0 });
  });

  it("is let go where she is: the picture does not jump as the turning point moves", () => {
    const feet = { x: 100, y: 80 };
    // Hanging straight: nothing moves.
    expect(letGo(feet, { angle: 0, spin: 0 }, { vx: 0, vy: 0 }).body).toMatchObject({ x: 100, y: 80, vx: 0, vy: 0, angle: 0, spin: 0 });
    // Swung out a quarter turn: her middle is level with the hand, out to the side.
    const out = letGo(feet, { angle: Math.PI / 2, spin: 0 }, { vx: 0, vy: 0 }).body;
    expect(out.x).toBeCloseTo(100 - HOLD_REACH);
    expect(out.y).toBeCloseTo(80 - HOLD_REACH);
    expect(out.angle).toBeCloseTo(Math.PI / 2);
  });

  it("is flung by her own swing, and by the hand", () => {
    // A still hand, but she is swinging through the bottom: she flies on that way, a toss.
    const swung = letGo({ x: 100, y: 80 }, { angle: 0, spin: -9 }, { vx: 0, vy: 0 });
    expect(swung.body.vx).toBeCloseTo(9 * HOLD_REACH);
    expect(swung.tossed).toBe(true);
    // A still hand and a still Pip: a drop, no spin.
    const dropped = letGo({ x: 100, y: 80 }, { angle: 0.2, spin: 0 }, { vx: 0, vy: 0 });
    expect(dropped.tossed).toBe(false);
    expect(dropped.body.spin).toBe(0);
    // A moving hand: its speed, and a tumble the way she goes.
    const thrown = letGo({ x: 100, y: 80 }, { angle: 0, spin: 0 }, { vx: 300, vy: -200 });
    expect(thrown.body).toMatchObject({ vx: 300, vy: -200 });
    expect(thrown.body.spin).toBeCloseTo(9);
    // Never faster than the room can take.
    expect(letGo({ x: 0, y: 0 }, { angle: 0, spin: -14 }, { vx: 400, vy: 0 }).body.vx).toBe(TOSS_MAX);
  });

  it("is caught out of the air as she is: the same picture, and her speed swings her", () => {
    const flying: Body = { x: 150, y: 60, vx: 260, vy: 0, angle: Math.PI * 2 + 0.5, spin: 7 };
    const { hold, feet } = caught(flying);
    expect(hold.swing.angle).toBeCloseTo(0.5);
    // Going right, stopped by the leaf: her body swings on to the right (an anticlockwise turn).
    expect(hold.swing.spin).toBeLessThan(-5);
    // Letting go again at once puts her back where she was.
    const again = letGo(feet, { angle: hold.swing.angle, spin: 0 }, { vx: 0, vy: 0 }).body;
    expect(again.x).toBeCloseTo(150);
    expect(again.y).toBeCloseTo(60);
    // Falling straight down, upright, there is nothing to swing her.
    expect(caught({ x: 0, y: 0, vx: 0, vy: 300, angle: 0, spin: 0 }).hold.swing).toMatchObject({ angle: 0 });
  });

  it("rights herself the short way round", () => {
    expect(nearUpright(0)).toBe(0);
    expect(nearUpright(Math.PI * 2 + 0.3)).toBeCloseTo(0.3);
    expect(nearUpright(Math.PI * 2 - 0.3)).toBeCloseTo(-0.3);
    expect(nearUpright(-0.3 - Math.PI * 4)).toBeCloseTo(-0.3);
  });
});

describe("Pip thrown", () => {
  const room = { left: 12, right: 228, top: 30, floor: 109 };
  /** Flies until she lands (or four seconds are up), at `frame` ms a step. */
  const fly = (start: Body, frame = 16) => {
    let body = start;
    const floor: number[] = [];
    let walls = 0;
    let landedAt = -1;
    for (let t = frame; t <= 4000 && landedAt < 0; t += frame) {
      const next = flyStep(body, frame / 1000, room, PIP_BOUNCE, true);
      if (next.impact > 0) floor.push(next.impact);
      else if (next.hit) walls += 1;
      body = next.body;
      expect(body.x).toBeGreaterThanOrEqual(room.left);
      expect(body.x).toBeLessThanOrEqual(room.right);
      expect(body.y).toBeGreaterThanOrEqual(room.top);
      expect(body.y).toBeLessThanOrEqual(room.floor);
      if (next.landed) landedAt = t;
    }
    return { body, floor, walls, landedAt };
  };

  it("bounces off the floor, lower each time, and lands", () => {
    const flight = fly({ x: 120, y: 60, vx: 150, vy: -200, angle: 0, spin: 6 });
    expect(flight.landedAt).toBeGreaterThan(0);
    expect(flight.floor.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < flight.floor.length; index += 1) expect(flight.floor[index]).toBeLessThan(flight.floor[index - 1]);
    expect(flight.body.y).toBe(room.floor);
    expect(flight.body.vy).toBe(0);
  });

  it("comes off a wall slower, turning the other way", () => {
    let body: Body = { x: 220, y: 60, vx: 400, vy: 0, angle: 0, spin: 8 };
    let hit = false;
    while (!hit) ({ body, hit } = flyStep(body, 0.016, room, PIP_BOUNCE, true));
    expect(body.x).toBe(room.right);
    expect(body.vx).toBeCloseTo(-220);
    expect(body.spin).toBeCloseTo(-4.8);
  });

  it("always comes down inside the room, however she is thrown, at any frame rate", () => {
    const speeds = [-TOSS_MAX, -200, 0, 200, TOSS_MAX];
    for (const frame of [7, 16, 40, 50]) {
      for (const [x, y] of [[12, 30], [228, 30], [12, 109], [228, 109], [120, 30], [120, 70]]) {
        for (const vx of speeds) {
          for (const vy of speeds) {
            const flight = fly({ x, y, vx, vy, angle: 0, spin: vx * 0.03 }, frame);
            expect(flight.landedAt).toBeGreaterThan(0);
            expect(flight.landedAt).toBeLessThan(3500);
            expect(Number.isFinite(flight.body.angle)).toBe(true);
          }
        }
      }
    }
  });

  it("drops from a still hand under gravity alone", () => {
    const flight = fly({ x: 120, y: 49, vx: 0, vy: 0, angle: 0, spin: 0 });
    // 60 pixels at 900 a second squared: a third of a second to the floor, then a small bounce.
    expect(flight.floor[0]).toBeGreaterThan(300);
    expect(flight.floor[0]).toBeLessThan(345);
    expect(flight.body.x).toBe(120);
    expect(flight.body.angle).toBe(0);
    expect(flight.walls).toBe(0);
  });
});

describe("what counts as play", () => {
  it("counts a kind of play once in a while, not every frame", () => {
    expect(playCounts(undefined, 0)).toBe(true);
    expect(playCounts(1000, 1000 + PLAY_EVERY_MS - 1)).toBe(false);
    expect(playCounts(1000, 1000 + PLAY_EVERY_MS)).toBe(true);
  });
});
