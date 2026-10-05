import { describe, expect, it } from "vitest";
import { LIB } from "./index";
import {
  PEEK_S,
  PEEK_SHARE,
  SPOOKED_FOR_MIN,
  TUCKED_QUIET_MIN,
  VISITOR_CLEAR,
  besideVisitor,
  busySeconds,
  chooseActivity,
  crossesVisitor,
  goodbyeLine,
  greetVisitor,
  helloLine,
  knockedLine,
  missedLine,
  nightStir,
  peekLine,
  planActivity,
  activityAt,
  seeded,
  spookedTonight,
  stopForVisitor,
  visitorZone,
  weights,
  type Activity,
  type ActivityId,
  type BehaviourState,
  type NightState,
  type Spot,
  type Step
} from "./behaviour";

const BED: Spot = { kind: "bed", x: 34, w: 42, id: "bed" };
const BOOKS: Spot = { kind: "books", x: 184, w: 14, up: true, id: "bookstack" };
const WINDOW: Spot = { kind: "window", x: 120, w: 36, up: true, id: "window" };
const FRIDGE: Spot = { kind: "fridge", x: 175, w: 12, id: "bedroom/fixture:minifridge" };
const room: Spot[] = [BOOKS, WINDOW, { kind: "seat", x: 120, w: 52, up: true, id: "rug" }, BED, FRIDGE];

/** A visitor standing with their feet at 152: the box their sprite takes. */
const VISITOR = { x: 136, w: 32, handle: "maya" };

const state = (over: Partial<BehaviourState> = {}): BehaviourState => ({
  mood: 70,
  hour: 15,
  floor: { w: 240, garden: false, arcade: false },
  x: 60,
  spots: room,
  toys: ["treat-ball"],
  dances: [],
  signature: "read",
  hobbies: ["jog", "rope", "tree"],
  recent: [],
  ...over
});

const walks = (activity: Activity) => activity.steps.filter((step): step is Extract<Step, { kind: "walk" }> => step.kind === "walk");
const moves = (activity: Activity) => activity.steps.flatMap((step) => (step.kind === "do" ? [step.move] : []));

/** Every place her feet are along a plan, a pixel at a time. */
const path = (activity: Activity, from: number) => {
  const at: number[] = [from];
  let x = from;
  for (const walk of walks(activity)) {
    const dir = walk.x < x ? -1 : 1;
    for (let step = x; dir < 0 ? step >= walk.x : step <= walk.x; step += dir) at.push(step);
    x = walk.x;
  }
  return at;
};

describe("a visitor in the room", () => {
  it("has a box she keeps out of, and a little either side", () => {
    expect(visitorZone(VISITOR)).toEqual({ from: 136 - VISITOR_CLEAR, to: 168 + VISITOR_CLEAR });
    // From the left she is stopped at its left edge, from the right at its right.
    expect(stopForVisitor(VISITOR, 60, 184)).toBe(132);
    expect(stopForVisitor(VISITOR, 60, 150)).toBe(132);
    expect(stopForVisitor(VISITOR, 220, 100)).toBe(172);
    // A walk that stays on her side is not stopped; nor is one with nobody there.
    expect(stopForVisitor(VISITOR, 60, 120)).toBeNull();
    expect(stopForVisitor(VISITOR, 60, 132)).toBeNull();
    expect(stopForVisitor(VISITOR, 220, 180)).toBeNull();
    expect(stopForVisitor(null, 60, 184)).toBeNull();
    // Put down inside it (the reader's doing): she may walk out, either way.
    expect(stopForVisitor(VISITOR, 150, 60)).toBeNull();
    expect(stopForVisitor(VISITOR, 150, 220)).toBeNull();
  });

  it("is never walked through, whatever she chooses, from either side", () => {
    for (const from of [30, 60, 110, 190, 220]) {
      for (const hour of [9, 15, 20]) {
        const rand = seeded(from + hour);
        const recent: ActivityId[] = [];
        for (let index = 0; index < 300; index += 1) {
          const at = state({ x: from, hour, recent, world: { visitor: VISITOR } });
          const activity = chooseActivity(at, rand);
          // Plain comparisons, and one expect for each activity: an expect for
          // every step of every walk is a few hundred thousand of them, which
          // ran past the time limit on a busy machine.
          const zone = visitorZone(VISITOR);
          const inside = path(activity, from).filter((x) => x > zone.from && x < zone.to);
          if (crossesVisitor(activity, at) || inside.length > 0) {
            expect.fail(`${activity.id} from ${from} at ${hour}h walks through the visitor at x ${inside[0] ?? "?"}`);
          }
          recent.unshift(activity.id);
          recent.length = Math.min(recent.length, 3);
        }
      }
    }
  });

  it("turns a thing beyond them into their company, for now", () => {
    // The books are past the visitor: she reads beside them instead.
    const blocked = planActivity("read", state({ world: { visitor: VISITOR }, spots: [BOOKS] }), seeded(1));
    expect(blocked.id).toBe("company");
    // The reader points her at the books all the same: the same answer.
    expect(activityAt("read", BOOKS, state({ world: { visitor: VISITOR } }), seeded(1)).id).toBe("company");
    // With nobody in the way it is the read it always was.
    expect(planActivity("read", state({ spots: [BOOKS] }), seeded(1)).id).toBe("read");
    // And from the far side of them the books are hers.
    expect(planActivity("read", state({ x: 220, world: { visitor: VISITOR }, spots: [BOOKS] }), seeded(1)).id).toBe("read");
  });

  it("is someone to read beside: on her own side of them, turned to them, a good long read", () => {
    expect(weights(state()).company).toBe(0);
    expect(weights(state({ world: { visitor: VISITOR } })).company).toBeGreaterThan(weights(state()).read);
    expect(besideVisitor(VISITOR, 60, 240)).toEqual({ x: 124, face: 1 });
    expect(besideVisitor(VISITOR, 220, 240)).toEqual({ x: 180, face: -1 });
    // A visitor hard by the wall: the side there is room on.
    expect(besideVisitor({ x: 200, w: 32 }, 230, 240)).toEqual({ x: 188, face: 1 });
    expect(besideVisitor({ x: 8, w: 32 }, 10, 240)).toEqual({ x: 52, face: -1 });
    const rand = seeded(4);
    for (let index = 0; index < 40; index += 1) {
      const activity = planActivity("company", state({ world: { visitor: VISITOR } }), rand);
      expect(activity.label).toBe("reading beside her visitor");
      expect(activity.steps.slice(0, 2)).toEqual([{ kind: "walk", x: 124 }, { kind: "face", dir: 1 }]);
      expect(moves(activity)).toEqual(["read", "bookmark"]);
      expect(busySeconds(activity)).toBeGreaterThanOrEqual(23);
    }
    // Chosen often while they are here, and never twice running.
    const picks: ActivityId[] = [];
    const recent: ActivityId[] = [];
    const chooser = seeded(9);
    for (let index = 0; index < 300; index += 1) {
      const id = chooseActivity(state({ world: { visitor: VISITOR }, recent }), chooser).id;
      picks.push(id);
      recent.unshift(id);
      recent.length = Math.min(recent.length, 3);
    }
    expect(picks.filter((id) => id === "company").length).toBeGreaterThan(60);
    for (let index = 1; index < picks.length; index += 1) expect(picks[index] === "company" && picks[index - 1] === "company").toBe(false);
  });

  it("is greeted by name as they arrive: over, a wave, then the book", () => {
    const hello = greetVisitor(state({ world: { visitor: VISITOR } }), seeded(2));
    expect(hello.id).toBe("company");
    expect(hello.label).toBe("saying hello to her visitor");
    expect(moves(hello)).toEqual(["welcome", "read", "bookmark"]);
    const wave = hello.steps.find((step) => step.kind === "do" && step.move === "welcome") as Extract<Step, { kind: "do" }>;
    expect(wave.line).toContain("@maya");
    // Without motion she is simply beside them (the scene puts her there).
    const still = greetVisitor(state({ reduced: true, world: { visitor: VISITOR } }), seeded(2));
    expect(walks(still)).toEqual([{ kind: "walk", x: 124 }]);
    for (const move of moves(hello)) expect(LIB.some((entry) => entry.id === move)).toBe(true);
  });

  it("gives her a few short things to say, a long handle or none", () => {
    for (const lines of [knockedLine, goodbyeLine, missedLine, peekLine]) {
      const rand = seeded(6);
      const said = new Set(Array.from({ length: 60 }, () => lines(rand)));
      expect(said.size).toBeGreaterThanOrEqual(3);
      for (const line of said) {
        expect(line).toBe(line.toLowerCase());
        expect(line.length).toBeLessThanOrEqual(44);
      }
    }
    const rand = seeded(3);
    for (const handle of ["maya", "a-reader-with-a-very-long-handle-indeed-123", undefined]) {
      for (let index = 0; index < 20; index += 1) expect(helloLine(rand, handle).length).toBeLessThanOrEqual(44);
    }
    expect(helloLine(seeded(1), "maya")).toContain("@maya");
  });
});

describe("the night after a horror", () => {
  const asleep = (over: Partial<NightState> = {}): NightState => ({ hour: 1, fridge: true, asleepFor: 5, tuckedAgo: null, stirredAgo: null, recent: [], ...over });
  const stirs = (over: Partial<NightState>, count = 4000) => {
    const rand = seeded(13);
    return Array.from({ length: count }, () => nightStir(asleep(over), rand));
  };

  it("is a night she may wake and peek out from under the quilt, now and then", () => {
    const night = stirs({ spooked: true });
    const peeks = night.filter((stir) => stir === "peek").length;
    const up = night.filter((stir) => stir !== null).length;
    // Rare: about one stir in four, a stir being about one look at the clock in three.
    expect(peeks).toBeGreaterThan(4000 * 0.3 * PEEK_SHARE * 0.7);
    expect(peeks).toBeLessThan(4000 * 0.3 * PEEK_SHARE * 1.3);
    expect(peeks).toBeLessThan(up / 2);
    // The fridge and the phone still have their nights.
    expect(night).toContain("fridge");
    expect(night).toContain("scroll");
    expect(PEEK_S).toBeLessThanOrEqual(12);
    expect(LIB.some((entry) => entry.id === "quilt-hide")).toBe(true);
  });

  it("never without a horror read that evening, and leaves those nights exactly as they were", () => {
    expect(stirs({})).not.toContain("peek");
    expect(stirs({ spooked: false })).toEqual(stirs({}));
    const book = (mood: "horror" | "fantasy" | null, readAgoMin: number | null) => ({ book: { title: "b", mood, readAgoMin } });
    expect(spookedTonight(book("horror", 30))).toBe(true);
    expect(spookedTonight(book("horror", SPOOKED_FOR_MIN))).toBe(true);
    expect(spookedTonight(book("horror", SPOOKED_FOR_MIN + 1))).toBe(false);
    expect(spookedTonight(book("fantasy", 30))).toBe(false);
    expect(spookedTonight(book(null, 30))).toBe(false);
    expect(spookedTonight(book("horror", null))).toBe(false);
    expect(spookedTonight({})).toBe(false);
    expect(spookedTonight(undefined)).toBe(false);
  });

  it("obeys the rules of the night: not tucked in, not by day, not twice running, not straight after", () => {
    for (const tuckedAgo of [0, 5, TUCKED_QUIET_MIN - 0.1]) expect(stirs({ spooked: true, tuckedAgo }, 500).every((stir) => stir === null)).toBe(true);
    expect(stirs({ spooked: true, tuckedAgo: TUCKED_QUIET_MIN })).toContain("peek");
    for (const hour of [7, 12, 18]) expect(stirs({ spooked: true, hour }, 300).every((stir) => stir === null)).toBe(true);
    expect(stirs({ spooked: true, recent: ["spooked"] })).not.toContain("peek");
    expect(stirs({ spooked: true, recent: ["fridge", "spooked"] })).toContain("peek");
    expect(stirs({ spooked: true, asleepFor: 0.1 }, 500).every((stir) => stir === null)).toBe(true);
    expect(stirs({ spooked: true, stirredAgo: 1 }, 500).every((stir) => stir === null)).toBe(true);
    // With no fridge and too early for the phone, a peek is all there is.
    const bare = stirs({ spooked: true, fridge: false, hour: 20 });
    expect(new Set(bare)).toEqual(new Set([null, "peek"]));
  });
});
