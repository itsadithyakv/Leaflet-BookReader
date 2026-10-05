import { describe, expect, it } from "vitest";
import { LIB } from "./index";
import {
  bundled,
  chooseActivity,
  coldPace,
  coldRest,
  coldStage,
  fidget,
  planActivity,
  seeded,
  weights,
  type Activity,
  type ActivityId,
  type BehaviourState,
  type Cold,
  type Spot
} from "./behaviour";

// The face of Pip's cold: what she does and how she goes about with one. The
// rule (when she has it) is Rust's and its words are pip/cold.ts's, each with
// tests of its own.

const room: Spot[] = [
  { kind: "books", x: 184, w: 14, up: true, id: "bookstack" },
  { kind: "window", x: 120, w: 36, up: true, id: "window" },
  { kind: "bed", x: 34, w: 42, id: "bed" }
];
const state = (over: Partial<BehaviourState> = {}): BehaviourState => ({
  mood: 70,
  hour: 15,
  floor: { w: 240, garden: false, arcade: false },
  x: 120,
  spots: room,
  toys: ["treat-ball"],
  dances: ["floss"],
  signature: "read",
  hobbies: ["jog", "rope", "tree"],
  recent: [],
  ...over
});
/** A cold as the habit snapshot gives it, `cure` of the way better. */
const cold = (cure: number): Cold => ({ since: "2026-10-10", brokeFrom: 12, cure, minutesLeftToday: Math.max(1, Math.round((1 - cure) * 20)), daysLeft: 3 });
const withCold = (cure: number, over: Partial<BehaviourState> = {}) => state({ world: { cold: cold(cure) }, ...over });
const moves = (activity: Activity) => activity.steps.flatMap((step) => (step.kind === "do" ? [step.move] : []));
const lines = (activity: Activity) => activity.steps.flatMap((step) => (step.kind === "do" && step.line ? [step.line] : []));
const run = (seed: number, count: number, at: BehaviourState) => {
  const rand = seeded(seed);
  const recent: ActivityId[] = [];
  const done: Activity[] = [];
  for (let index = 0; index < count; index += 1) {
    const activity = chooseActivity({ ...at, recent }, rand);
    done.push(activity);
    recent.unshift(activity.id);
    recent.length = Math.min(recent.length, 3);
  }
  return done;
};

describe("how a cold shows", () => {
  it("has three stages by how far today's reading has cured it, and none when she is well", () => {
    expect(coldStage(null)).toBeNull();
    expect(coldStage(undefined)).toBeNull();
    expect(coldStage(cold(0))).toBe("bad");
    expect(coldStage(cold(0.33))).toBe("bad");
    expect(coldStage(cold(0.34))).toBe("mending");
    expect(coldStage(cold(0.66))).toBe("mending");
    expect(coldStage(cold(0.67))).toBe("nearly");
    expect(coldStage(cold(0.99))).toBe("nearly");
    expect(coldStage(cold(1))).toBeNull();
    // A number that is no number is no cold.
    expect(coldStage(cold(Number.NaN))).toBeNull();
  });

  it("gets better visibly as the reader reads: the blanket goes, the walk quickens, the rests shorten", () => {
    expect([0, 0.5, 0.8, 1].map((cure) => bundled(cold(cure)))).toEqual([true, true, false, false]);
    const paces = [0, 0.5, 0.8, 1].map((cure) => coldPace(cold(cure)));
    const rests = [0, 0.5, 0.8, 1].map((cure) => coldRest(cold(cure)));
    for (let index = 1; index < 4; index += 1) {
      expect(paces[index]).toBeGreaterThan(paces[index - 1]);
      expect(rests[index]).toBeLessThan(rests[index - 1]);
    }
    expect(paces[3]).toBe(1);
    expect(rests[3]).toBe(1);
    expect(coldPace(null)).toBe(1);
    expect(paces[0]).toBeGreaterThanOrEqual(0.5);
  });
});

describe("what she does with a cold", () => {
  it("is nothing that bounces, more sleep, and looking after it", () => {
    for (const cure of [0, 0.5, 0.8]) {
      const w = weights(withCold(cure));
      for (const id of ["dance", "exercise", "toy", "arcade", "sunbathe", "quest"] as const) expect(w[id]).toBe(0);
      expect(w.nurse).toBeGreaterThan(0);
      expect(w.nap).toBeGreaterThan(weights(state()).nap);
      // A book is still hers.
      expect(w.read).toBe(weights(state()).read);
    }
    expect(weights(state()).nurse).toBe(0);
    expect(weights(withCold(1)).nurse).toBe(0);
    expect(weights(withCold(1))).toEqual(weights(state({ world: { cold: null } })));
    // The worse it is, the more of her day it takes.
    expect(weights(withCold(0)).nurse).toBeGreaterThan(weights(withCold(0.5)).nurse);
    expect(weights(withCold(0.5)).nurse).toBeGreaterThan(weights(withCold(0.8)).nurse);
    expect(weights(withCold(0)).stroll).toBeLessThan(weights(withCold(0.8)).stroll);
  });

  it("is quieter the worse it is, and never the same thing twice running", () => {
    const lively = (done: Activity[]) => done.filter((activity) => ["dance", "exercise", "toy", "stroll", "phone", "fridge"].includes(activity.id)).length;
    const well = run(3, 400, state());
    const bad = run(3, 400, withCold(0.1));
    const nearly = run(3, 400, withCold(0.9));
    expect(lively(bad)).toBeLessThan(lively(nearly));
    expect(lively(nearly)).toBeLessThan(lively(well));
    for (const done of [bad, nearly]) for (let index = 1; index < done.length; index += 1) expect(done[index].id).not.toBe(done[index - 1].id);
    expect(bad.some((activity) => activity.id === "nurse")).toBe(true);
    expect(well.some((activity) => activity.id === "nurse")).toBe(false);
  });

  it("looks after it three ways while it is bad, and with a brighter word when nearly well", () => {
    const rand = seeded(8);
    const labels = new Set<string>();
    const said = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const activity = planActivity("nurse", withCold(0.2), rand);
      labels.add(activity.label);
      lines(activity).forEach((line) => said.add(line));
      for (const move of moves(activity)) expect(LIB.some((entry) => entry.id === move), move).toBe(true);
      expect(moves(activity)).toContain("sniffle");
    }
    expect(labels).toEqual(new Set(["blowing her nose", "sneezing", "having tea under a blanket"]));
    const better = new Set<string>();
    for (let index = 0; index < 60; index += 1) {
      const activity = planActivity("nurse", withCold(0.9), rand);
      expect(activity.label).toBe("getting over a cold");
      expect(moves(activity)).toEqual(["sniffle", "stretch"]);
      lines(activity).forEach((line) => better.add(line));
    }
    expect(better.size).toBeGreaterThanOrEqual(3);
    for (const line of [...said, ...better]) {
      expect(line).toBe(line.toLowerCase());
      expect(line.length).toBeLessThanOrEqual(44);
      // Never a word of blame.
      expect(line).not.toMatch(/your fault|you (didn't|did not|forgot|missed|broke)|should have|streak/);
    }
    // Without motion: no sneeze, only the sniffle.
    for (let index = 0; index < 60; index += 1) expect(moves(planActivity("nurse", withCold(0.2, { reduced: true }), rand))).not.toContain("sneeze");
    for (const move of ["cold-idle", "sniffle", "tissue", "shuffle", "tea", "sneeze"]) expect(LIB.some((entry) => entry.id === move), move).toBe(true);
  });

  it("sniffles between things, and does not bop", () => {
    const rand = seeded(5);
    const small = (cure: number | null) => Array.from({ length: 300 }, () => fidget({ mood: 80, hour: 15, world: cure === null ? undefined : { cold: cold(cure) } }, null, rand).move);
    expect(small(null)).not.toContain("sniffle");
    expect(small(null)).toContain("bop");
    for (const cure of [0.1, 0.5, 0.9]) {
      expect(small(cure)).toContain("sniffle");
      expect(small(cure)).not.toContain("bop");
    }
    const count = (done: string[]) => done.filter((move) => move === "sniffle").length;
    expect(count(small(0.1))).toBeGreaterThan(count(small(0.9)));
    expect(small(0.1)).not.toContain("stretch");
  });
});
