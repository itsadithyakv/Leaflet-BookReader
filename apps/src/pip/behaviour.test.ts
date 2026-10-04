import { describe, expect, it } from "vitest";
import {
  GLUM,
  activityAt,
  busySeconds,
  chooseActivity,
  fidget,
  fidgetGap,
  fidgetsBetween,
  gazeAt,
  gazeMove,
  seeded,
  standAt,
  weights,
  type ActivityId,
  type BehaviourState,
  type Spot
} from "./behaviour";

const bedroom: Spot[] = [
  { kind: "books", x: 184, w: 14, up: true, id: "bookstack" },
  { kind: "window", x: 120, w: 36, up: true, id: "window" },
  { kind: "seat", x: 120, w: 52, up: true, id: "rug" }
];

const state = (over: Partial<BehaviourState> = {}): BehaviourState => ({
  mood: 70,
  hour: 10,
  floor: { w: 240, garden: false, arcade: false },
  x: 120,
  spots: bedroom,
  toys: [],
  dances: [],
  signature: "read",
  hobbies: ["jog", "rope", "tree"],
  recent: [],
  ...over
});

/** A long run of choices, each fed the ones before it, as the house does. */
const day = (seed: number, count: number, over: Partial<BehaviourState> = {}) => {
  const rand = seeded(seed);
  const recent: ActivityId[] = [];
  const done: ActivityId[] = [];
  for (let index = 0; index < count; index += 1) {
    const activity = chooseActivity(state({ ...over, recent }), rand);
    done.push(activity.id);
    recent.unshift(activity.id);
    recent.length = Math.min(recent.length, 3);
  }
  return done;
};

describe("what Pip does next", () => {
  it("is the same for the same seed, and different for another", () => {
    expect(day(7, 30)).toEqual(day(7, 30));
    expect(day(7, 30)).not.toEqual(day(8, 30));
  });

  it("never does the same thing twice running", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const done = day(seed, 200);
      for (let index = 1; index < done.length; index += 1) expect(done[index]).not.toBe(done[index - 1]);
    }
  });

  it("does many different things in a day, not one", () => {
    expect(new Set(day(11, 80)).size).toBeGreaterThanOrEqual(5);
  });

  it("only does what the room and her things allow", () => {
    const bare = day(3, 300, { spots: [] });
    for (const id of ["window", "water", "tend", "toy", "arcade", "sunbathe"]) expect(bare).not.toContain(id);
    expect(day(3, 300, { toys: ["treat-ball"] })).toContain("toy");
    expect(day(3, 300, { spots: [{ kind: "cabinet", x: 60, w: 30 }], floor: { w: 240, garden: false, arcade: true } })).toContain("arcade");
    expect(day(3, 300, { spots: [{ kind: "plot", x: 60, w: 28 }], floor: { w: 240, garden: true, arcade: false } })).toContain("tend");
  });

  it("reads for a believable while, with a beginning and an end", () => {
    const rand = seeded(5);
    for (let index = 0; index < 40; index += 1) {
      const activity = chooseActivity(state({ recent: ["stroll"], spots: bedroom, hobbies: [], mood: 70 }), rand);
      if (activity.id !== "read") continue;
      const moves = activity.steps.filter((step) => step.kind === "do");
      // (All told: a glance at her phone part way through does not make it shorter.)
      const reading = moves.reduce((sum, step) => sum + (step.kind === "do" && step.move === "read" ? step.seconds : 0), 0);
      expect(reading).toBeGreaterThanOrEqual(20);
      expect(reading).toBeLessThanOrEqual(40);
      // The book is taken down first and put back last; a yawn or a bookmark ends the reading.
      expect(moves[0]).toMatchObject({ move: "pointup" });
      expect(moves[moves.length - 1]).toMatchObject({ move: "pointup" });
      expect(["yawn", "bookmark"]).toContain((moves[moves.length - 2] as { move: string }).move);
      // She walks to the books before she takes one.
      expect(activity.steps[0]).toEqual({ kind: "walk", x: 184 });
    }
  });

  it("keeps every activity long enough to mean something and short enough to end", () => {
    const rand = seeded(21);
    const recent: ActivityId[] = [];
    for (let index = 0; index < 300; index += 1) {
      const activity = chooseActivity(state({ recent, toys: ["treat-duck"], dances: ["floss"], spots: [...bedroom, { kind: "plant", x: 40, w: 16 }] }), rand);
      recent.unshift(activity.id);
      recent.length = Math.min(recent.length, 3);
      const seconds = busySeconds(activity);
      expect(seconds).toBeGreaterThanOrEqual(5);
      expect(seconds).toBeLessThanOrEqual(50);
      expect(activity.steps.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("walks only to places on the floor", () => {
    const rand = seeded(9);
    for (let index = 0; index < 200; index += 1) {
      const activity = chooseActivity(state({ x: 20 + (index % 200), spots: [...bedroom, { kind: "plant", x: 4, w: 16 }, { kind: "music", x: 236, w: 30 }] }), rand);
      for (const step of activity.steps) {
        if (step.kind !== "walk") continue;
        expect(step.x).toBeGreaterThanOrEqual(18);
        expect(step.x).toBeLessThanOrEqual(222);
      }
    }
  });
});

describe("mood, the clock and the reader", () => {
  it("keeps to quiet things when glum", () => {
    const glum = weights(state({ mood: GLUM - 1, toys: ["treat-ball"], dances: ["floss"], spots: [...bedroom, { kind: "cabinet", x: 60, w: 30 }] }));
    expect(glum.dance).toBe(0);
    expect(glum.toy).toBe(0);
    expect(glum.arcade).toBe(0);
    expect(glum.exercise).toBe(0);
    expect(glum.window).toBeGreaterThan(weights(state()).window);
    expect(glum.nap).toBeGreaterThan(weights(state()).nap);
  });

  it("dances and plays more when happy", () => {
    const happy = weights(state({ mood: 90, toys: ["treat-ball"] }));
    const fine = weights(state({ mood: 50, toys: ["treat-ball"] }));
    expect(happy.dance).toBeGreaterThan(fine.dance);
    expect(happy.toy).toBeGreaterThan(fine.toy);
  });

  it("follows the time of day", () => {
    expect(weights(state({ hour: 20 })).read).toBeGreaterThan(weights(state({ hour: 10 })).read);
    expect(weights(state({ hour: 14 })).nap).toBeGreaterThan(weights(state({ hour: 10 })).nap);
    expect(weights(state({ hour: 18 })).window).toBeGreaterThan(weights(state({ hour: 12 })).window);
    const garden = { w: 240, garden: true, arcade: false };
    expect(weights(state({ hour: 12, floor: garden })).sunbathe).toBeGreaterThan(0);
    expect(weights(state({ hour: 23, floor: garden })).sunbathe).toBe(0);
  });

  it("follows what the reader just did", () => {
    expect(weights(state({ justNow: { fed: true } })).nap).toBeGreaterThan(weights(state()).nap);
    expect(weights(state({ justNow: { gamed: true } })).read).toBeGreaterThan(weights(state()).read);
    expect(weights(state({ justNow: { gamed: true }, spots: [{ kind: "cabinet", x: 60, w: 30 }] })).arcade).toBe(0);
    expect(weights(state({ justNow: { played: true } })).dance).toBeGreaterThan(weights(state()).dance);
  });

  it("stands still when the reader asked for less motion", () => {
    const rand = seeded(4);
    const recent: ActivityId[] = [];
    for (let index = 0; index < 100; index += 1) {
      const activity = chooseActivity(state({ reduced: true, recent, toys: ["treat-ball"], dances: ["floss"] }), rand);
      recent.unshift(activity.id);
      recent.length = Math.min(recent.length, 3);
      // (And a glance at her phone, which is done standing too.)
      expect(["read", "nap", "window", "phone"]).toContain(activity.id);
      expect(activity.steps.every((step) => step.kind === "do" || step.kind === "pause")).toBe(true);
    }
  });
});

describe("where she stands", () => {
  it("is beside a thing on the floor, turned to it, on the side she came from", () => {
    expect(standAt({ kind: "plant", x: 100, w: 16 }, 40, 240)).toEqual({ x: 81, face: 1 });
    expect(standAt({ kind: "plant", x: 100, w: 16 }, 200, 240)).toEqual({ x: 119, face: -1 });
  });

  it("is never in the wall", () => {
    expect(standAt({ kind: "plant", x: 10, w: 16 }, 5, 240)).toEqual({ x: 29, face: -1 });
    expect(standAt({ kind: "plant", x: 232, w: 16 }, 239, 240)).toEqual({ x: 213, face: 1 });
  });

  it("is under a thing on the wall", () => {
    expect(standAt({ kind: "window", x: 120, w: 36, up: true }, 30, 240)).toEqual({ x: 120, face: 1 });
  });
});

describe("standing about", () => {
  it("never fidgets the same way twice running", () => {
    const rand = seeded(2);
    let last: string | null = null;
    for (let index = 0; index < 100; index += 1) {
      const next = fidget({ mood: 70, hour: 20 }, last, rand);
      expect(next.move).not.toBe(last);
      last = next.move;
    }
  });

  it("does not hum when glum, and yawns only late", () => {
    const rand = seeded(6);
    const glum = Array.from({ length: 200 }, () => fidget({ mood: 5, hour: 12 }, null, rand).move);
    expect(glum).not.toContain("bop");
    expect(glum).not.toContain("yawn");
    expect(Array.from({ length: 200 }, () => fidget({ mood: 80, hour: 23 }, null, rand).move)).toContain("yawn");
  });

  it("leaves a few seconds between small things, and one or two of them between activities", () => {
    const rand = seeded(8);
    for (let index = 0; index < 100; index += 1) {
      const gap = fidgetGap(rand);
      expect(gap).toBeGreaterThanOrEqual(2.5);
      expect(gap).toBeLessThanOrEqual(5);
      expect([1, 2]).toContain(fidgetsBetween(rand));
    }
  });
});

describe("following the pointer", () => {
  const face = { x: 100, y: 100 };

  it("rests when the pointer is on her", () => {
    expect(gazeAt(face, { x: 104, y: 97 })).toEqual({ dx: 0, dy: 0 });
    expect(gazeMove({ dx: 0, dy: 0 })).toBe("idle");
    expect(gazeMove({ dx: 0, dy: 0 }, "mope")).toBe("mope");
  });

  it("looks each of the eight ways", () => {
    expect(gazeMove(gazeAt(face, { x: 200, y: 100 }))).toBe("eye-r");
    expect(gazeMove(gazeAt(face, { x: 0, y: 100 }))).toBe("eye-l");
    expect(gazeMove(gazeAt(face, { x: 100, y: 0 }))).toBe("eye-u");
    expect(gazeMove(gazeAt(face, { x: 100, y: 200 }))).toBe("eye-d");
    expect(gazeMove(gazeAt(face, { x: 200, y: 0 }))).toBe("eye-ur");
    expect(gazeMove(gazeAt(face, { x: 0, y: 0 }))).toBe("eye-ul");
    expect(gazeMove(gazeAt(face, { x: 200, y: 200 }))).toBe("eye-dr");
    expect(gazeMove(gazeAt(face, { x: 0, y: 200 }))).toBe("eye-dl");
  });
});

describe("the room the reader has been at", () => {
  it("goes and straightens a crooked picture, soon", () => {
    const spots = [...bedroom, { kind: "crooked" as const, x: 36, w: 18, up: true, id: "bedroom/wall-1:poster" }];
    expect(weights(state({ spots })).tidy).toBeGreaterThan(weights(state({ spots })).read);
    expect(weights(state({ spots: bedroom })).tidy).toBe(0);
    const rand = seeded(11);
    let tidied = 0;
    // (A long enough run that the count is the rule's and not the seed's: about one choice in three.)
    for (let index = 0; index < 200; index += 1) {
      const activity = chooseActivity(state({ spots, x: 120 }), rand);
      if (activity.id !== "tidy") continue;
      tidied += 1;
      // Under it, a reach up, the picture set straight, and she is pleased with it.
      expect(activity.steps[0]).toEqual({ kind: "walk", x: 36 });
      expect(activity.steps).toContainEqual({ kind: "use", id: "bedroom/wall-1:poster", what: "straighten" });
      expect(activity.steps.findIndex((step) => step.kind === "use")).toBeGreaterThan(1);
    }
    expect(tidied).toBeGreaterThan(40);
  });

  it("naps in her bed when it is out: the same sleep, under the covers, and up again", () => {
    const spots = [...bedroom, { kind: "bed" as const, x: 34, w: 42, id: "bed" }];
    const rand = seeded(5);
    let napped = 0;
    for (let index = 0; index < 80 && napped < 3; index += 1) {
      const activity = chooseActivity(state({ spots, hour: 14, x: 150 }), rand);
      if (activity.id !== "nap") continue;
      napped += 1;
      const sleep = activity.steps.find((step) => step.kind === "use");
      expect(sleep).toMatchObject({ kind: "use", id: "bed", what: "sleep" });
      expect(sleep && sleep.kind === "use" && sleep.what === "sleep" && sleep.seconds).toBeGreaterThanOrEqual(16);
      expect(sleep && sleep.kind === "use" && sleep.what === "sleep" && sleep.seconds).toBeLessThanOrEqual(28);
      // Beside the bed first, and a stretch after.
      expect(activity.steps.some((step) => step.kind === "walk")).toBe(true);
      expect(activity.steps[activity.steps.length - 1]).toMatchObject({ kind: "do", move: "stretch" });
      expect(activity.steps.some((step) => step.kind === "do" && step.move === "sleep")).toBe(false);
      expect(busySeconds(activity)).toBeLessThan(40);
    }
    expect(napped).toBe(3);
  });
});

describe("called over by the reader", () => {
  it("reads at the books pointed at, not the nearest", () => {
    const far = { kind: "books" as const, x: 30, w: 14, id: "bookstack-far" };
    const activity = activityAt("read", far, state({ spots: [...bedroom, far], x: 180 }), seeded(2));
    expect(activity.id).toBe("read");
    // Beside the far stack (on the side she comes from), not under the shelf she is standing by.
    expect(activity.steps[0]).toEqual({ kind: "walk", x: 48 });
    expect(activity.steps.some((step) => step.kind === "do" && step.move === "read")).toBe(true);
  });

  it("looks out of the window pointed at, standing under it", () => {
    const porthole = { kind: "window" as const, x: 200, w: 34, up: true, id: "roundwindow" };
    const activity = activityAt("window", porthole, state({ spots: [...bedroom, porthole], x: 40 }), seeded(2));
    expect(activity.steps[0]).toEqual({ kind: "walk", x: 200 });
    expect(activity.steps[1]).toMatchObject({ kind: "do", move: "gaze" });
  });

  it("does it from where she stands when motion is reduced", () => {
    const porthole = { kind: "window" as const, x: 200, w: 34, up: true, id: "roundwindow" };
    const activity = activityAt("window", porthole, state({ spots: [porthole], x: 40, reduced: true }), seeded(2));
    expect(activity.steps.every((step) => step.kind === "do")).toBe(true);
  });
});
