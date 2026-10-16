import { describe, expect, it } from "vitest";
import { DEMO_STEPS, LINES, REPLAY_LINES, STEP, STEP_COUNT, advancesBy, doorOpen, effectsOf, nextDemo, resolveStep, running, stepDone, stepId, type World } from "./steps";
import type { CampWelcome } from "./welcomeApi";

const welcome = (over: Partial<CampWelcome> = {}, tutorial: Partial<CampWelcome["tutorial"]> = {}): CampWelcome =>
  ({
    given: true,
    paws: 2,
    windfall: 20,
    basketOpened: false,
    firstReadParcel: "waiting",
    prowlersAfterRead: true,
    from: 0,
    ...over,
    tutorial: { step: 0, done: false, skipped: false, ...tutorial }
  }) as CampWelcome;

const fresh = (over: Partial<World> = {}): World => ({
  ready: true,
  welcome: welcome({ given: false, paws: 0 }),
  gathered: 0,
  store: 0,
  burrow: 1,
  job: null,
  place: "hollow",
  hatOn: false,
  ...over
});

describe("the guided session's steps", () => {
  it("has a short line in Pip's voice for every step", () => {
    expect(Object.keys(LINES)).toHaveLength(STEP_COUNT);
    for (const line of Object.values(LINES)) {
      expect(line.length).toBeLessThanOrEqual(80);
      expect(line).toBe(line.toLowerCase());
    }
    expect(stepId(STEP.door)).toBe("door");
  });

  it("never starts before the sync guard is down, nor for a camp whose session is over", () => {
    expect(running(fresh({ ready: false }))).toBe(false);
    expect(running(fresh())).toBe(true);
    expect(running(fresh({ welcome: welcome({}, { done: true }) }))).toBe(false);
    expect(running(fresh({ welcome: welcome({}, { done: true, skipped: true }) }))).toBe(false);
    expect(running(fresh({ welcome: null }))).toBe(false);
    // A replay runs whatever the camp says.
    expect(running(fresh({ welcome: welcome({}, { done: true }) }), true)).toBe(true);
  });

  it("asks for nothing before the sync guard", () => {
    expect(effectsOf(STEP.larder, fresh({ ready: false, welcome: welcome(), job: "store" }))).toEqual([]);
    expect(effectsOf(STEP.hello, fresh({ welcome: welcome() }))).toEqual([]);
  });

  it("leaves hello and the bridge by Pip's key, the rest by doing them", () => {
    expect(advancesBy(STEP.hello)).toBe("next");
    expect(advancesBy(STEP.bridge)).toBe("next");
    for (const step of [STEP.oak, STEP.larder, STEP.basket, STEP.burrow, STEP.door, STEP.hat]) expect(advancesBy(step)).toBe("doing");
    // In a replay, everything is a next.
    for (let step = 0; step < STEP_COUNT; step++) expect(advancesBy(step, true)).toBe("next");
  });

  it("knows each step done from the camp as it stands", () => {
    const given = welcome();
    expect(stepDone(STEP.oak, fresh({ welcome: given }))).toBe(false);
    expect(stepDone(STEP.oak, fresh({ welcome: given }), true)).toBe(true);
    expect(stepDone(STEP.oak, fresh({ welcome: given, gathered: 20 }))).toBe(true);
    expect(stepDone(STEP.larder, fresh({ welcome: given, job: "store" }))).toBe(false);
    expect(stepDone(STEP.larder, fresh({ welcome: given, store: 1 }))).toBe(true);
    expect(stepDone(STEP.basket, fresh({ welcome: given }))).toBe(false);
    expect(stepDone(STEP.basket, fresh({ welcome: welcome({ basketOpened: true }) }))).toBe(true);
    expect(stepDone(STEP.burrow, fresh({ welcome: given, burrow: 1, job: "burrow" }))).toBe(false);
    expect(stepDone(STEP.burrow, fresh({ welcome: given, burrow: 2 }))).toBe(true);
    expect(stepDone(STEP.door, fresh({ welcome: given }))).toBe(false);
    expect(stepDone(STEP.door, fresh({ welcome: given, place: "home" }))).toBe(true);
    // The hat is bought indoors; the step is over once she is out wearing it.
    expect(stepDone(STEP.hat, fresh({ welcome: given, place: "home", hatOn: true }))).toBe(false);
    expect(stepDone(STEP.hat, fresh({ welcome: given, place: "hollow", hatOn: true }))).toBe(true);
    expect(stepDone(STEP.hello, fresh({ welcome: given, gathered: 99, store: 3, burrow: 5 }))).toBe(false);
    expect(stepDone(STEP.bridge, fresh({ welcome: given, gathered: 99, store: 3, burrow: 5 }))).toBe(false);
  });

  it("resumes at the saved step, and on past what is done already, never back", () => {
    const given = welcome();
    // Closed in the middle of the larder's step, with nothing built: the larder again.
    expect(resolveStep(STEP.larder, fresh({ welcome: given, gathered: 20 }))).toBe(STEP.larder);
    // The larder went up before the app closed: on to the basket.
    expect(resolveStep(STEP.larder, fresh({ welcome: given, gathered: 20, store: 1 }))).toBe(STEP.basket);
    // Larder, basket and burrow all done: at the door.
    expect(resolveStep(STEP.larder, fresh({ welcome: welcome({ basketOpened: true }), gathered: 20, store: 1, burrow: 2 }))).toBe(STEP.door);
    // Hello waits for its key, whatever the camp has done.
    expect(resolveStep(STEP.hello, fresh({ welcome: given, gathered: 20, store: 1 }))).toBe(STEP.hello);
    // Never back: a saved step past one that is not done stays where it was.
    expect(resolveStep(STEP.burrow, fresh({ welcome: given }))).toBe(STEP.burrow);
    // Reopened outside after buying the hat: the bridge.
    expect(resolveStep(STEP.hat, fresh({ welcome: given, burrow: 2, hatOn: true }))).toBe(STEP.bridge);
    // Reopened outside without the hat: still the hat's step (the door again).
    expect(resolveStep(STEP.hat, fresh({ welcome: given, burrow: 2 }))).toBe(STEP.hat);
    // Out of range is held in range.
    expect(resolveStep(99, fresh({ welcome: given }))).toBe(STEP.bridge);
    expect(resolveStep(-3, fresh({ welcome: given }))).toBe(STEP.hello);
  });

  it("puts a helping paw on the larder and the burrow while they go up, and nowhere else", () => {
    const given = welcome();
    expect(effectsOf(STEP.larder, fresh({ welcome: given, job: "store" }))).toEqual([{ kind: "paw", target: "store" }]);
    expect(effectsOf(STEP.burrow, fresh({ welcome: given, job: "burrow" }))).toEqual([{ kind: "paw", target: "burrow" }]);
    // Not while nothing is going up, not on the wrong step, not with no paws left.
    expect(effectsOf(STEP.larder, fresh({ welcome: given }))).toEqual([]);
    expect(effectsOf(STEP.basket, fresh({ welcome: given, job: "store" }))).toEqual([]);
    expect(effectsOf(STEP.larder, fresh({ welcome: welcome({ paws: 0 }), job: "store" }))).toEqual([]);
  });

  it("says in a replay what things are for, not that the camp is bare", () => {
    for (const step of DEMO_STEPS) {
      const line = REPLAY_LINES[stepId(step)];
      expect(line).toBe(line.toLowerCase());
      expect(line).not.toMatch(/bare/);
    }
  });

  it("replays as a demo that grants nothing", () => {
    const at = fresh({ welcome: welcome({ given: false, paws: 2 }, { done: true }), job: "store" });
    for (const step of DEMO_STEPS) expect(effectsOf(step, at, true)).toEqual([]);
    // It walks the steps out in the camp, and ends.
    const seen: number[] = [STEP.hello];
    for (let step = nextDemo(STEP.hello); step !== null; step = nextDemo(step)) seen.push(step);
    expect(seen).toEqual([...DEMO_STEPS]);
    expect(seen).not.toContain(STEP.hat);
    expect(nextDemo(STEP.bridge)).toBeNull();
  });

  it("opens the burrow's door to one tap outside the tour, and in it only from the door's step", () => {
    expect(doorOpen(null)).toBe(true);
    expect(doorOpen(STEP.burrow)).toBe(false);
    expect(doorOpen(STEP.larder)).toBe(false);
    expect(doorOpen(STEP.door)).toBe(true);
    expect(doorOpen(STEP.hat)).toBe(true);
    expect(doorOpen(STEP.door, true)).toBe(false);
  });
});
