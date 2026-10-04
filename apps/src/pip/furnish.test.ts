import { describe, expect, it } from "vitest";
import {
  CURTAIN_GLIDE,
  KINDS,
  TILT_MAX,
  bedSleep,
  curtainPull,
  curtainReaction,
  curtainSettle,
  curtainStep,
  curtainToggle,
  freeSpan,
  furnishKey,
  hangStep,
  hangingAngle,
  hangingFrom,
  hangsOff,
  hangsStill,
  kept,
  kindOf,
  lampReaction,
  nudge,
  parseRemembered,
  roomShade,
  slideTo,
  straighten,
  withRemembered,
  withinSpan,
  type FurnishKind,
  type Hanging
} from "./furnish";
import { swingStep } from "./play";

describe("what can be used", () => {
  it("knows the Window's curtains, and leaves other decor alone", () => {
    expect(kindOf("window")).toBe("curtains");
    expect(kindOf("poster")).toBe("picture");
    expect(kindOf("bed")).toBe("bed");
    expect(kindOf("armchair")).toBeNull();
  });

  it("says, for every kind, what the hand and the keyboard do", () => {
    for (const kind of Object.keys(KINDS) as FurnishKind[]) {
      expect(KINDS[kind].how.length).toBeGreaterThan(10);
      expect(KINDS[kind].keys.length).toBeGreaterThan(5);
    }
  });
});

describe("what is remembered", () => {
  const key = furnishKey("bedroom", "window-1", "window");

  it("keeps drawn curtains, per window, and nothing for open ones", () => {
    const drawn = withRemembered({}, key, "curtains", { closed: 1 });
    expect(drawn).toEqual({ "bedroom/window-1:window": { closed: 1 } });
    expect(withRemembered(drawn, key, "curtains", { closed: 0 })).toEqual({});
    const two = withRemembered(drawn, furnishKey("observatory", "window-2", "window"), "curtains", { closed: 1 });
    expect(Object.keys(two)).toHaveLength(2);
  });

  it("keeps only a kind's own fields", () => {
    expect(kept("curtains", { closed: 0.8, tilt: 0.4 })).toEqual({ closed: 1 });
    expect(kept("picture", { closed: 1, dx: 12.4, tilt: 0.18 })).toEqual({ dx: 12, tilt: 0.18 });
    // A picture where the room hangs it, straight, is not worth remembering; nor is anything about the bed.
    expect(kept("picture", { dx: 0.2, tilt: 0.004 })).toEqual({});
    expect(kept("bed", { closed: 1, dx: 5 })).toEqual({});
    // Nothing out of range comes back from storage.
    expect(kept("picture", { dx: 99999, tilt: 9 })).toEqual({ dx: 400, tilt: TILT_MAX });
  });

  it("reads back what it wrote, and nothing it does not understand", () => {
    const drawn = withRemembered({}, key, "curtains", { closed: 1 });
    expect(parseRemembered(JSON.stringify(drawn))).toEqual(drawn);
    expect(parseRemembered(null)).toEqual({});
    expect(parseRemembered("not json")).toEqual({});
    expect(parseRemembered("[1,2]")).toEqual({});
    expect(parseRemembered(JSON.stringify({ [key]: { closed: "yes" }, "bedroom/floor-1:armchair": { closed: 1 }, nonsense: { closed: 1 }, [`${key}:x`]: 3 }))).toEqual({});
  });
});

describe("curtains", () => {
  it("follow the hand: towards the middle draws them, away opens them, from wherever they were", () => {
    // From open, the hand goes from the edge (18 from the middle) to 9 from it: half drawn.
    expect(curtainPull(0, 18, 9, 18)).toBeCloseTo(0.5);
    // On to the middle: closed, and no further.
    expect(curtainPull(0, 18, 0, 18)).toBe(1);
    expect(curtainPull(0.6, 18, 0, 18)).toBe(1);
    // From closed, the hand goes out from the middle: open again.
    expect(curtainPull(1, 2, 20, 18)).toBe(0);
    // The hand has not moved: nothing has.
    expect(curtainPull(0.3, 7, 7, 18)).toBeCloseTo(0.3);
  });

  it("settle the nearer way when let go, and go the other way when tapped", () => {
    expect(curtainSettle(0.49)).toBe(0);
    expect(curtainSettle(0.5)).toBe(1);
    expect(curtainToggle(0)).toBe(1);
    expect(curtainToggle(1)).toBe(0);
  });

  it("glide shut in about a quarter of a second, and stop there", () => {
    let closed = 0;
    let frames = 0;
    while (closed !== 1 && frames < 100) {
      closed = curtainStep(closed, 1, 1 / 60);
      frames += 1;
    }
    expect(closed).toBe(1);
    expect(frames).toBe(Math.ceil(CURTAIN_GLIDE * 60));
    expect(curtainStep(1, 1, 1 / 60)).toBe(1);
    expect(curtainStep(0.4, 0, 1 / 60)).toBeLessThan(0.4);
  });

  it("are there at once when motion is reduced", () => {
    expect(curtainStep(0, 1, 1 / 60, true)).toBe(1);
  });

  it("dim the room as far as they are drawn, more by day than by night", () => {
    expect(roomShade([], false)).toBe(0);
    expect(roomShade([0], false)).toBe(0);
    expect(roomShade([1], false)).toBeGreaterThan(roomShade([0.5], false));
    expect(roomShade([1], false)).toBeGreaterThan(roomShade([1], true));
    // Two windows, one drawn: half as dim.
    expect(roomShade([1, 0], false)).toBeCloseTo(roomShade([1], false) / 2);
    expect(roomShade([1], false)).toBeLessThan(0.4);
  });

  it("make Pip yawn at night and protest by day, then accept it", () => {
    const night = curtainReaction(true, 23);
    expect(night).toMatchObject({ move: "yawn", sleepy: true });
    const day = curtainReaction(true, 14);
    expect(day.move).toBe("squint");
    expect(day.sleepy).toBeUndefined();
    expect(day.then?.line).toMatch(/fine/);
    // Opened again: pleased, either way, and not sleepy.
    expect(curtainReaction(false, 14).sleepy).toBeUndefined();
    expect(curtainReaction(false, 2).move).toBe("gaze");
  });
});

describe("a picture on the wall", () => {
  /** Lets it swing until it stops (or ten seconds are up). Returns how long it took, and the widest it swung. */
  const settle = (picture: Hanging) => {
    let now = picture;
    let widest = 0;
    let t = 0;
    while (t < 10 && !hangsStill(now)) {
      now = hangStep(now, 1 / 60);
      widest = Math.max(widest, Math.abs(now.hold.swing.angle));
      t += 1 / 60;
    }
    return { picture: now, t, widest };
  };

  it("swings on its nail when nudged, and settles hanging crooked", () => {
    const hit = nudge(hangingFrom({}), 1);
    // The picture has not moved yet: it starts swinging from where it hung.
    expect(hangingAngle(hit)).toBeCloseTo(0);
    expect(hit.hold.swing.spin).toBeGreaterThan(0);
    expect(hangsOff(hit)).toBe(true);
    const { picture, t, widest } = settle(hit);
    expect(t).toBeGreaterThan(1);
    expect(t).toBeLessThan(6);
    expect(widest).toBeGreaterThan(0.15);
    expect(widest).toBeLessThan(0.8);
    expect(hangingAngle(picture)).toBeCloseTo(0.18, 1);
    expect(picture.tilt).toBeCloseTo(0.18);
  });

  it("swings by the same pendulum as Pip in the hand", () => {
    const hit = nudge(hangingFrom({}), -1);
    const next = hangStep(hit, 1 / 60);
    expect(next.hold.swing).toEqual(swingStep(hit.hold.swing, 0, 1 / 60));
  });

  it("gets more crooked nudged the same way, never past a limit, and goes straight nudged back", () => {
    let picture = hangingFrom({});
    for (let index = 0; index < 5; index += 1) picture = settle(nudge(picture, 1)).picture;
    expect(picture.tilt).toBe(TILT_MAX);
    picture = settle(nudge(picture, -1)).picture;
    expect(picture.tilt).toBe(0);
    expect(hangingAngle(picture)).toBeCloseTo(0, 1);
    expect(hangsOff({ ...picture, hold: hangingFrom({}).hold })).toBe(false);
  });

  it("is set straight by Pip without a jump, and stays where it was hung", () => {
    const crooked = settle(nudge(hangingFrom({ dx: 14 }), -1)).picture;
    const fixed = straighten(crooked);
    expect(hangingAngle(fixed)).toBeCloseTo(hangingAngle(crooked));
    const done = settle(fixed).picture;
    expect(done.tilt).toBe(0);
    expect(Math.abs(hangingAngle(done))).toBeLessThan(0.01);
    expect(done.dx).toBe(14);
  });

  it("swings behind the hand that slides it along the wall", () => {
    let picture = hangingFrom({});
    let before = { x: 0, y: 0, at: 0 };
    for (let index = 1; index <= 12; index += 1) {
      const sample = { x: index * 3, y: 0, at: index * 16 };
      picture = hangStep(slideTo(picture, sample.x, before, sample), 0.016);
      before = sample;
    }
    expect(picture.dx).toBe(36);
    // Slid to the right, its bottom trails to the left: a clockwise turn.
    expect(hangingAngle(picture)).toBeGreaterThan(0.05);
    expect(settle(picture).picture.tilt).toBe(0);
  });

  it("does not swing when motion is reduced: it is simply where it should be", () => {
    const hit = hangStep(nudge(hangingFrom({}), 1), 0, true);
    expect(hangsStill(hit)).toBe(true);
    expect(hangingAngle(hit)).toBeCloseTo(0.18);
  });

  it("slides only where the wall is free: not over the window, a shelf or another picture", () => {
    // The bedroom: the poster (18 x 22) at 27,23; the window at 102,25; the shelf's room at 174..222, 46..68.
    const poster = { x: 27, y: 23, w: 18, h: 22 };
    const window = { x: 102, y: 25, w: 36, h: 30 };
    const shelf = { x: 174, y: 46, w: 48, h: 22 };
    const bed = { x: 13, y: 88, w: 42, h: 24 };
    const span = freeSpan(poster, [window, shelf, bed], 240);
    // Left to the wall's edge; right until two pixels short of the window. The bed, below, is not in the way.
    expect(span).toEqual({ min: -25, max: 55 });
    expect(withinSpan(200, span)).toBe(55);
    expect(withinSpan(-200, span)).toBe(-25);
    // A second picture to its left stops it there.
    expect(freeSpan(poster, [window, { x: 4, y: 20, w: 16, h: 28 }], 240).min).toBe(-5);
    // Something it already overlaps where it hangs does not trap it.
    expect(freeSpan(poster, [{ x: 30, y: 30, w: 10, h: 10 }], 240)).toEqual({ min: -25, max: 193 });
  });
});

describe("the bed", () => {
  it("is a nap by day and the night after dark", () => {
    const nap = bedSleep(14, () => 0.5);
    expect(nap).toBeGreaterThanOrEqual(30);
    expect(nap).toBeLessThanOrEqual(45);
    expect(bedSleep(23, () => 0.5)).toBeNull();
    expect(bedSleep(3, () => 0.5)).toBeNull();
  });
});

describe("the rest of the room", () => {
  it("has every window style do something, and the books and the lights", () => {
    for (const id of ["roundwindow", "archedwindow", "baywindow", "stainedglass", "skylight"]) expect(kindOf(id)).toBe("window");
    for (const id of ["bookstack", "bookshelf", "tallshelf", "desk", "lectern"]) expect(kindOf(id)).toBe("books");
    for (const id of ["lamp", "hangingbulb", "chandelier", "paperlantern", "wallsconce", "candles"]) expect(kindOf(id)).toBe("lamp");
  });

  it("remembers a light switched off, and nothing about one left on", () => {
    const key = furnishKey("bedroom", "floor-2", "lamp");
    const off = withRemembered({}, key, "lamp", { off: true });
    expect(off).toEqual({ "bedroom/floor-2:lamp": { off: true } });
    expect(parseRemembered(JSON.stringify(off))).toEqual(off);
    expect(withRemembered(off, key, "lamp", { off: false })).toEqual({});
    expect(kept("lamp", { off: "yes" } as never)).toEqual({});
    expect(kept("books", { off: true })).toEqual({});
  });

  it("has Pip mind a light going out after dark, and not by day", () => {
    expect(lampReaction(true, 14)).toBeNull();
    expect(lampReaction(false, 14)).toBeNull();
    expect(lampReaction(true, 22)?.move).toBe("squint");
    expect(lampReaction(false, 22)?.line).toMatch(/better/);
  });
});
