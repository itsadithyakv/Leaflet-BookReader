import { afterEach, describe, expect, it } from "vitest";
import { LIB } from "./index";
import {
  TOGETHER_VERB,
  VISITOR_CLEAR,
  besideVisitor,
  chaseTurn,
  crossesVisitor,
  greetVisitor,
  landedBy,
  seeded,
  togetherPlan,
  visitorZone,
  type Activity,
  type BehaviourState,
  type Step
} from "./behaviour";
import {
  CHASE_TURN_MS,
  TOGETHER_AFTER_MS,
  TOGETHER_BEFORE_END_MS,
  TOGETHER_MS,
  chaseMs,
  togetherBeats,
  togetherPose,
  visitPose,
  visitTimeline,
  type TogetherKind,
  type VisitorAct
} from "./visitors";
import { PLAYDATES_KEPT, parsePlaydates, withPlaydate } from "./playdates";
import { useVisitorStore } from "./useVisitors";
import { diaryEntries, entryFor } from "./diary/entry";
import { diaryFacts } from "./diary/facts";
import type { DayRecord } from "../services/habitService";

/** A visitor standing with their feet at 152, in a room 240 wide that runs on to -40 and 280 (a phone on its side). */
const VISITOR = { x: 136, w: 32, handle: "maya" };
const KINDS: TogetherKind[] = ["highfive", "dance", "ball", "chase"];

const state = (over: Partial<BehaviourState> = {}): BehaviourState => ({
  mood: 70,
  hour: 15,
  floor: { w: 280, left: -40, garden: false, arcade: false },
  x: 60,
  spots: [],
  toys: [],
  dances: [],
  signature: "read",
  hobbies: [],
  recent: [],
  world: { visitor: VISITOR },
  ...over
});

/** The verb of a step on a thing, if it is one. */
const verbOf = (step: Step) => (step.kind === "use" && step.what === "thing" ? step.verb : null);
/** Where her feet end up along a plan. */
const endOf = (activity: Activity, from: number) => activity.steps.reduce((x, step) => (step.kind === "walk" ? step.x : x), from);
const inZone = (x: number) => x > visitorZone(VISITOR).from && x < visitorZone(VISITOR).to;
const RECORD = { handle: "maya", from: 1_760_000_000_000 };
const TIMELINE = visitTimeline(5 * 60_000, 60);

describe("the two Pips, together", () => {
  it("plan the same things at the same times for the same visit, and something else for another", () => {
    const beats = togetherBeats(RECORD, TIMELINE);
    expect(togetherBeats({ ...RECORD }, visitTimeline(5 * 60_000, 60))).toEqual(beats);
    expect(beats.length).toBeGreaterThan(0);
    const others = [1, 2, 3, 4, 5].map((n) => JSON.stringify(togetherBeats({ handle: `friend${n}`, from: RECORD.from + n }, TIMELINE)));
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it("only do things while the visitor sits reading, well after the hello and before the goodbye, apart", () => {
    const readFrom = TIMELINE.knock + TIMELINE.walk + TIMELINE.hello;
    const readTo = readFrom + TIMELINE.read;
    for (let n = 0; n < 40; n++) {
      const beats = togetherBeats({ handle: `reader${n}`, from: RECORD.from + n * 997 }, TIMELINE);
      let last = -Infinity;
      for (const beat of beats) {
        expect(beat.at).toBeGreaterThanOrEqual(readFrom + TOGETHER_AFTER_MS);
        expect(beat.at + (beat.kind === "chase" ? 10_000 : TOGETHER_MS[beat.kind]) + TOGETHER_BEFORE_END_MS).toBeLessThanOrEqual(readTo);
        expect(beat.at - last).toBeGreaterThanOrEqual(40_000);
        expect(visitPose(beat.at, TIMELINE, 300, 152).phase).toBe("read");
        last = beat.at;
      }
      // A short visit has room for nothing: they read.
      expect(togetherBeats({ handle: `reader${n}`, from: RECORD.from }, visitTimeline(40_000, 60))).toEqual([]);
    }
  });

  it("keep reading side by side the commonest thing: most of a visit, and about half the turns, are a read", () => {
    let together = 0;
    let read = 0;
    for (let n = 0; n < 200; n++) {
      const beats = togetherBeats({ handle: `r${n}`, from: n * 7919 }, TIMELINE);
      together += beats.reduce((sum, beat) => sum + (beat.kind === "chase" ? 10_000 : TOGETHER_MS[beat.kind]), 0);
      read += TIMELINE.read;
    }
    expect(together / read).toBeLessThan(0.25);
  });

  it("end every one of her plans beside the visitor, clear of them, on the floor", () => {
    for (const kind of KINDS) {
      for (const from of [-30, 20, 60, 120, 200, 260]) {
        for (let seed = 0; seed < 6; seed++) {
          const plan = togetherPlan(kind, state({ x: from }), seeded(seed));
          const end = endOf(plan, from);
          expect(inZone(end), `${kind} from ${from}: ends at ${end}`).toBe(false);
          expect(end).toBeGreaterThanOrEqual(-40 + 18);
          expect(end).toBeLessThanOrEqual(280 - 18);
          // The visitor's part starts on a step of hers, once.
          expect(plan.steps.filter((step) => verbOf(step)?.startsWith(TOGETHER_VERB))).toHaveLength(1);
          // Only a chase runs through the visitor's place; the rest go round to her own side.
          if (kind !== "chase" && kind !== "ball") expect(crossesVisitor(plan, state({ x: from })), `${kind} from ${from}`).toBe(false);
          for (const step of plan.steps) if (step.kind === "do") expect(LIB.some((move) => move.id === step.move), step.move).toBe(true);
        }
      }
    }
  });

  it("run a chase to the far end of the floor and back, the visitor ending in its place and Pip beside it", () => {
    const far = chaseTurn(VISITOR, state());
    // The visitor's middle is 152: further from the left end (-40) than the right (280).
    expect(far).toBe(-40 + 18 + 6);
    const act: VisitorAct = { kind: "chase", from: 1000, until: 1000 + chaseMs(152, far), far };
    const at = (t: number) => togetherPose(act, 1000 + t, 152, 120);
    expect(at(0)?.x).toBe(152);
    const run = ((152 - far) * 1000) / 60;
    expect(at(run + CHASE_TURN_MS / 2)).toMatchObject({ x: far, move: "laugh" });
    expect(at(chaseMs(152, far) - 1)?.x).toBeGreaterThanOrEqual(151);
    // Whole pixels, always.
    for (let t = 0; t < chaseMs(152, far); t += 37) expect(Number.isInteger(at(t)?.x)).toBe(true);
    // Over: back to the visit's own pose, in its place.
    expect(togetherPose(act, act.until, 152)).toBeNull();
    const plan = togetherPlan("chase", state({ x: 124 }), seeded(1));
    const runs = plan.steps.filter((step): step is Extract<Step, { kind: "walk" }> => step.kind === "walk");
    expect(runs.every((step) => step.pace === "run")).toBe(true);
    expect(runs[0].x).toBe(far + 28);
  });

  it("are a high five and a dance in place without motion, never a chase or a game of ball", () => {
    for (const kind of KINDS) {
      const plan = togetherPlan(kind, state({ reduced: true }), seeded(3));
      expect(plan.steps.some((step) => step.kind === "walk" && step.pace === "run")).toBe(false);
      expect(plan.steps.some((step) => verbOf(step) === `${TOGETHER_VERB}ball` || verbOf(step) === `${TOGETHER_VERB}chase`)).toBe(false);
    }
  });

  it("greet with a high five, the visitor's hand meeting hers", () => {
    const hello = greetVisitor(state(), seeded(2));
    const five = hello.steps.findIndex((step) => verbOf(step) === `${TOGETHER_VERB}highfive`);
    const wave = hello.steps.findIndex((step) => step.kind === "do" && step.move === "welcome");
    expect(five).toBeGreaterThan(-1);
    expect(wave).toBe(five + 1);
  });

  it("catch Pip thrown onto the visitor, or go over in a heap with her, and then she stands clear", () => {
    for (const x of [130, 140, 152, 168, 176]) {
      const soft = landedBy(VISITOR, x, false, 280, -40);
      const hard = landedBy(VISITOR, x, true, 280, -40);
      expect(soft?.react).toBe("catch");
      expect(hard?.react).toBe("tumble");
      expect(inZone(soft?.stand.x ?? 152)).toBe(false);
      expect(soft?.stand).toEqual(besideVisitor(VISITOR, x, 280, -40));
    }
    // Clear of them: nothing to it.
    expect(landedBy(VISITOR, 100, true, 280, -40)).toBeNull();
    expect(landedBy(null, 152, true, 280, -40)).toBeNull();
    for (const kind of ["catch", "tumble"] as const) {
      const pose = togetherPose({ kind, from: 0, until: 2000 }, 1000, 152, 130);
      expect(LIB.some((move) => move.id === pose?.move)).toBe(true);
    }
    expect(VISITOR_CLEAR).toBeGreaterThan(0);
  });

  it("end cleanly when the visit does: no part to play without a visitor, and the visit's own pose after", () => {
    useVisitorStore.setState({ visit: null, act: null });
    useVisitorStore.getState().setAct({ kind: "dance", from: 0, until: 10_000 });
    expect(useVisitorStore.getState().act).toBeNull();
    useVisitorStore.setState({ visit: { record: { handle: "maya", from: 0, until: 300_000, kind: "visit" }, visitor: { handle: "maya", displayName: null, pipSeed: "maya", weekMinutes: 1, streak: 1 } } });
    useVisitorStore.getState().setAct({ kind: "dance", from: 0, until: 10_000 });
    expect(useVisitorStore.getState().act?.kind).toBe("dance");
    // Past its time a part plays nothing, whatever is still set: the visitor is back to reading in its place.
    expect(togetherPose(useVisitorStore.getState().act, 10_000, 152)).toBeNull();
  });
});

afterEach(() => {
  useVisitorStore.setState({ visit: null, note: null, phase: null, presence: "none", standing: null, act: null });
});

describe("Pip's diary of playdates", () => {
  it("keeps one line a day for each friend and each thing, the newest last, a few months at most", () => {
    let list = withPlaydate([], { day: "2026-10-20", handle: "maya", kind: "ball" });
    list = withPlaydate(list, { day: "2026-10-20", handle: "maya", kind: "ball" });
    list = withPlaydate(list, { day: "2026-10-20", handle: "maya", kind: "dance" });
    expect(list).toHaveLength(2);
    for (let n = 0; n < 300; n++) list = withPlaydate(list, { day: "2026-10-21", handle: `f${n}`, kind: "chase" });
    expect(list).toHaveLength(PLAYDATES_KEPT);
    expect(list[list.length - 1].handle).toBe("f299");
    expect(parsePlaydates([{ day: "2026-10-20", handle: "maya", kind: "ball" }, { day: "bad", handle: "x", kind: "ball" }, { day: "2026-10-20", handle: "", kind: "ball" }, { kind: "fly" }, null, 3])).toHaveLength(1);
    expect(parsePlaydates("nope")).toEqual([]);
  });

  it("writes the day's liveliest thing done with a friend's Pip into that day's entry, and nothing on a day without", () => {
    const day = (dateKey: string, minutes: number): DayRecord => ({ dateKey, minutes, goalMinutes: 10 } as DayRecord);
    const source = { days: [day("2026-10-19", 20), day("2026-10-20", 20)], sessions: [], freeReads: [], books: [], marks: [] };
    const facts = diaryFacts({ ...source, playdates: [{ day: "2026-10-20", handle: "maya", kind: "highfive" }, { day: "2026-10-20", handle: "maya", kind: "ball" }] }, "2026-10-20");
    const entries = diaryEntries(facts, "2026-10-20");
    const today = entries[entries.length - 1];
    expect(today.text).toContain("@maya's pip");
    expect(today.parts[today.parts.length - 1].kind).toBe("ball");
    expect(entries[0].text).not.toContain("@maya");
    // The same facts, the same words.
    expect(entryFor(facts.days[1]).text).toBe(entryFor(facts.days[1]).text);
    // Without the record (another device), the day reads as it always did.
    expect(diaryEntries(diaryFacts(source, "2026-10-20"), "2026-10-20")[1].text).not.toContain("@maya");
  });
});
