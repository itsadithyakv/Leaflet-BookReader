import { describe, expect, it } from "vitest";
import { LIB } from "./index";
import {
  STIR_AFTER_MIN,
  STIR_APART_MIN,
  TUCKED_QUIET_MIN,
  afterDark,
  bedtimeScroll,
  busySeconds,
  caughtLine,
  chooseActivity,
  fridgeVisit,
  hintLine,
  innocentLine,
  late,
  nightStir,
  scrollSeconds,
  scrollSession,
  scrollWindDown,
  seeded,
  shutOnHerLine,
  morningFridge,
  snoozeLine,
  snoozes,
  upLine,
  SNOOZE_S,
  weights,
  type Activity,
  type ActivityId,
  type BehaviourState,
  type NightState,
  type Spot,
  type Step
} from "./behaviour";

const FRIDGE: Spot = { kind: "fridge", x: 175, w: 12, id: "bedroom/fixture:minifridge" };
const BED: Spot = { kind: "bed", x: 34, w: 42, id: "bed" };
const room: Spot[] = [
  { kind: "books", x: 184, w: 14, up: true, id: "bookstack" },
  { kind: "window", x: 120, w: 36, up: true, id: "window" },
  { kind: "seat", x: 120, w: 52, up: true, id: "rug" },
  BED,
  FRIDGE
];

const state = (over: Partial<BehaviourState> = {}): BehaviourState => ({
  mood: 70,
  hour: 23,
  floor: { w: 240, garden: false, arcade: false },
  x: 63,
  spots: room,
  toys: [],
  dances: [],
  signature: "read",
  hobbies: ["jog", "rope", "tree"],
  recent: [],
  ...over
});

/** A long run of choices, each fed the ones before it, as the house does. */
const run = (seed: number, count: number, over: Partial<BehaviourState> = {}) => {
  const rand = seeded(seed);
  const recent: ActivityId[] = [];
  const done: Activity[] = [];
  for (let index = 0; index < count; index += 1) {
    const activity = chooseActivity(state({ ...over, recent }), rand);
    done.push(activity);
    recent.unshift(activity.id);
    recent.length = Math.min(recent.length, 3);
  }
  return done;
};

const DAY_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const uses = (activity: Activity, what: string) => activity.steps.filter((step) => step.kind === "use" && step.what === what).length;
const moves = (activity: Activity) => activity.steps.flatMap((step) => (step.kind === "do" ? [step.move] : []));
const said = (lines: (rand: () => number) => string) => {
  const rand = seeded(3);
  return new Set(Array.from({ length: 80 }, () => lines(rand)));
};

describe("when she feels like the fridge and the phone", () => {
  it("takes the phone to bed late, and never doom scrolls by day", () => {
    for (const hour of HOURS) {
      const w = weights(state({ hour }));
      if (hour >= 21 || hour < 5) {
        expect(late(hour)).toBe(true);
        expect(w.scroll).toBeGreaterThan(0);
        expect(w.phone).toBe(0);
      } else {
        expect(w.scroll).toBe(0);
        expect(w.phone).toBeGreaterThan(0);
        // A glance, not a habit: far below a book.
        expect(w.phone).toBeLessThan(w.read / 3);
      }
    }
    for (const hour of DAY_HOURS) expect(run(hour, 300, { hour }).map((activity) => activity.id)).not.toContain("scroll");
    for (const hour of [21, 23, 2]) expect(run(hour, 300, { hour }).map((activity) => activity.id)).not.toContain("phone");
  });

  it("raids the fridge mostly after dark, a little by day, and not at all without one", () => {
    for (const hour of HOURS) {
      const w = weights(state({ hour }));
      expect(w.fridge).toBeGreaterThan(0);
      if (afterDark(hour)) expect(w.fridge).toBeGreaterThanOrEqual(weights(state({ hour: 12 })).fridge * 4);
      expect(weights(state({ hour, spots: [BED] })).fridge).toBe(0);
    }
    expect(afterDark(19) && afterDark(23) && afterDark(5) && !afterDark(6) && !afterDark(18)).toBe(true);
    // Just fed, she is not looking for more.
    expect(weights(state({ justNow: { fed: true } })).fridge).toBeLessThan(weights(state()).fridge / 2);
    const night = run(5, 400).map((activity) => activity.id);
    const noon = run(5, 400, { hour: 12 }).map((activity) => activity.id);
    const count = (ids: ActivityId[], id: ActivityId) => ids.filter((entry) => entry === id).length;
    expect(count(night, "fridge")).toBeGreaterThan(count(noon, "fridge") * 2);
    expect(count(noon, "fridge")).toBeGreaterThan(0);
  });

  it("never does either twice running", () => {
    for (const hour of [21, 23, 3, 12]) {
      const done = run(hour + 1, 300, { hour }).map((activity) => activity.id);
      for (let index = 1; index < done.length; index += 1) expect(done[index]).not.toBe(done[index - 1]);
    }
    expect(weights(state({ recent: ["fridge"] })).fridge).toBe(0);
    expect(weights(state({ recent: ["scroll"] })).scroll).toBe(0);
    expect(weights(state({ hour: 12, recent: ["phone"] })).phone).toBe(0);
  });

  it("keeps both when she is glum: they are quiet things", () => {
    const glum = weights(state({ mood: 5 }));
    expect(glum.fridge).toBeGreaterThan(0);
    expect(glum.scroll).toBeGreaterThan(0);
  });
});

describe("the midnight snack", () => {
  const visits = (over: Partial<BehaviourState>, fromBed: boolean, count = 200) => {
    const rand = seeded(17);
    return Array.from({ length: count }, () => fridgeVisit(state(over), rand, fromBed));
  };

  it("is over on tiptoe, the door opened, a long stare, the door shut, and back to bed", () => {
    for (const visit of visits({}, true)) {
      expect(visit.id).toBe("fridge");
      expect(visit.label).toBe("having a midnight snack");
      // At the handle (the door swings out to the right), turned to it.
      expect(visit.steps[0]).toEqual({ kind: "walk", x: 159, pace: "tiptoe" });
      expect(visit.steps[1]).toEqual({ kind: "face", dir: 1 });
      expect(visit.steps[2]).toEqual({ kind: "use", id: FRIDGE.id, what: "open" });
      const stare = visit.steps[3] as Extract<Step, { kind: "do" }>;
      expect(stare.move).toBe("fridge-stare");
      expect(stare.seconds).toBeGreaterThanOrEqual(8);
      expect(stare.seconds).toBeLessThanOrEqual(14);
      // Every door opened is shut again, and she never eats at a shut one.
      let open = false;
      for (const step of visit.steps) {
        if (step.kind === "use" && step.what === "open") open = true;
        if (step.kind === "use" && step.what === "shut") open = false;
        if (step.kind === "do" && (step.move === "fridge-stare" || step.move === "nibble")) expect(open).toBe(true);
        if (step.kind === "walk" && step !== visit.steps[0]) expect(step.pace).toBe("tiptoe");
      }
      expect(open).toBe(false);
      expect(visit.steps[visit.steps.length - 1]).toEqual({ kind: "use", id: "bed", what: "bed" });
      expect(busySeconds(visit)).toBeLessThanOrEqual(50);
    }
  });

  it("goes three ways: something small, nothing at all, or a second look a little later", () => {
    const all = visits({}, true, 300);
    const took = all.filter((visit) => moves(visit).includes("nibble"));
    const again = all.filter((visit) => uses(visit, "open") === 2);
    const nothing = all.filter((visit) => !moves(visit).includes("nibble") && uses(visit, "open") === 1);
    expect(took.length).toBeGreaterThan(90);
    expect(nothing.length).toBeGreaterThan(40);
    expect(again.length).toBeGreaterThan(40);
    expect(again.length).toBeLessThan(120);
    for (const visit of again) {
      // Shut, off somewhere else, a wait, and back to the same spot.
      const shut = visit.steps.findIndex((step) => step.kind === "use" && step.what === "shut");
      const away = visit.steps[shut + 1] as Extract<Step, { kind: "walk" }>;
      expect(away.kind).toBe("walk");
      expect(Math.abs(away.x - 159)).toBeGreaterThanOrEqual(30);
      expect(visit.steps.some((step) => step.kind === "pause")).toBe(true);
      expect(visit.steps.filter((step) => step.kind === "walk" && step.x === 159)).toHaveLength(2);
      expect(moves(visit).filter((move) => move === "fridge-stare")).toHaveLength(2);
    }
    // Pleased with herself when she took something.
    for (const visit of took) expect(moves(visit)).toContain("bop");
  });

  it("is a plain, short look by day: no tiptoe, and she was never in bed", () => {
    for (const visit of visits({ hour: 15 }, false)) {
      expect(visit.label).toBe("looking in the fridge");
      expect(visit.steps.every((step) => step.kind !== "walk" || step.pace === undefined)).toBe(true);
      const stare = visit.steps[3] as Extract<Step, { kind: "do" }>;
      expect(stare.seconds).toBeGreaterThanOrEqual(4);
      expect(stare.seconds).toBeLessThanOrEqual(7);
      expect(uses(visit, "bed")).toBe(0);
    }
  });

  it("without motion she is simply at the fridge: no tiptoe, no wandering off and back", () => {
    for (const visit of visits({ reduced: true }, true)) {
      expect(visit.steps[0]).toEqual({ kind: "walk", x: 159 });
      expect(uses(visit, "open")).toBe(1);
      expect(visit.steps.filter((step) => step.kind === "walk")).toHaveLength(1);
    }
    // And the chooser keeps that walk (the scene puts her there), where it drops every other.
    const rand = seeded(9);
    let seen = 0;
    for (let index = 0; index < 200; index += 1) {
      const activity = chooseActivity(state({ reduced: true, recent: index % 2 ? ["read"] : [] }), rand);
      if (activity.id !== "fridge") continue;
      seen += 1;
      expect(activity.steps[0]).toEqual({ kind: "walk", x: 159 });
    }
    expect(seen).toBeGreaterThan(5);
  });

  it("uses only moves that exist", () => {
    for (const visit of [...visits({}, true, 60), ...visits({ hour: 15 }, false, 60)]) for (const move of moves(visit)) expect(LIB.some((entry) => entry.id === move)).toBe(true);
    expect(LIB.some((entry) => entry.id === "tiptoe")).toBe(true);
    expect(LIB.some((entry) => entry.id === "caught")).toBe(true);
  });
});

describe("doom scrolling", () => {
  it("is scrolling with small things between, one more, and asleep over it", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const beats = scrollSession(23, seeded(seed));
      expect(beats[0].beat).toBe("scroll");
      expect(beats[beats.length - 1]).toEqual({ beat: "doze", seconds: 4 });
      expect(beats[beats.length - 2]).toEqual({ beat: "scroll", seconds: 4 });
      const more = beats[beats.length - 3];
      expect(more.beat).toBe("yawn");
      expect(more.line).toMatch(/one|promise/);
      // Never two scrolls or two of the same small thing in a row, and the phone lands on her nose once at most.
      const small = beats.filter((beat) => beat.beat !== "scroll");
      for (let index = 1; index < beats.length; index += 1) expect(beats[index].beat === "scroll").not.toBe(beats[index - 1].beat === "scroll");
      // (Leaving aside the closing yawn and the doze.)
      for (let index = 1; index < small.length - 2; index += 1) expect(small[index].beat).not.toBe(small[index - 1].beat);
      expect(beats.filter((beat) => beat.beat === "drop").length).toBeLessThanOrEqual(1);
      expect(beats.some((beat) => beat.beat === "innocent")).toBe(false);
      for (const beat of beats) {
        expect(LIB.some((entry) => entry.id === (beat.beat === "scroll" ? "scroll" : `scroll-${beat.beat}`))).toBe(true);
        expect(LIB.some((entry) => entry.id === (beat.beat === "scroll" ? "phone" : `phone-${beat.beat}`))).toBe(true);
        if (beat.line) expect(beat.line).toBe(beat.line.toLowerCase());
      }
    }
    expect(LIB.some((entry) => entry.id === "scroll-asleep")).toBe(true);
    expect(LIB.some((entry) => entry.id === "innocent")).toBe(true);
  });

  it("goes on longer the later it gets", () => {
    const longest = (hour: number) => Math.max(...Array.from({ length: 40 }, (_, seed) => scrollSeconds(scrollSession(hour, seeded(seed + 1)))));
    const shortest = (hour: number) => Math.min(...Array.from({ length: 40 }, (_, seed) => scrollSeconds(scrollSession(hour, seeded(seed + 1)))));
    expect(longest(21)).toBeLessThan(shortest(0));
    expect(longest(23)).toBeLessThan(shortest(3));
    expect(shortest(21)).toBeGreaterThanOrEqual(28);
    expect(longest(4)).toBeLessThanOrEqual(110);
    // Long enough at it, and it lands on her nose; a short evening, never.
    expect(Array.from({ length: 40 }, (_, seed) => scrollSession(2, seeded(seed + 1))).every((beats) => beats.some((beat) => beat.beat === "drop"))).toBe(true);
    expect(Array.from({ length: 40 }, (_, seed) => scrollSession(21, seeded(seed + 1))).some((beats) => beats.some((beat) => beat.beat === "drop"))).toBe(false);
  });

  it("without motion nothing slips", () => {
    for (let seed = 1; seed <= 40; seed += 1) expect(scrollSession(2, seeded(seed), true).some((beat) => beat.beat === "drop")).toBe(false);
  });

  it("is in bed when there is one, and on her feet until she nods off when there is not", () => {
    const rand = seeded(31);
    let abed = 0;
    let afoot = 0;
    for (let index = 0; index < 300; index += 1) {
      const withBed = chooseActivity(state({ x: 150, recent: index % 2 ? ["read"] : [] }), rand);
      if (withBed.id === "scroll") {
        abed += 1;
        expect(withBed.steps[0]).toMatchObject({ kind: "walk" });
        const last = withBed.steps[withBed.steps.length - 1];
        expect(last).toMatchObject({ kind: "use", id: "bed", what: "scroll" });
        expect(last.kind === "use" && last.what === "scroll" && last.beats[last.beats.length - 1].beat).toBe("doze");
        expect(busySeconds(withBed)).toBeGreaterThanOrEqual(30);
      }
      const without = chooseActivity(state({ spots: [FRIDGE], recent: index % 2 ? ["read"] : [] }), rand);
      if (without.id === "scroll") {
        afoot += 1;
        expect(without.steps.every((step) => step.kind === "do")).toBe(true);
        expect(moves(without)[0]).toBe("phone");
        expect(moves(without).slice(-3)).toEqual(["phone-doze", "sleep", "stretch"]);
        for (const move of moves(without)) expect(LIB.some((entry) => entry.id === move)).toBe(true);
      }
    }
    expect(abed).toBeGreaterThan(10);
    expect(afoot).toBeGreaterThan(10);
  });

  it("is only a glance by day", () => {
    const glances = run(8, 400, { hour: 11 }).filter((activity) => activity.id === "phone");
    expect(glances.length).toBeGreaterThan(3);
    for (const glance of glances) {
      expect(moves(glance)).toEqual(["phone", "shift"]);
      expect(busySeconds(glance)).toBeLessThanOrEqual(10);
    }
  });

  it("winds down when the reader hints: a line, a yawn, asleep", () => {
    const beats = scrollWindDown(seeded(2));
    expect(beats.map((beat) => beat.beat)).toEqual(["scroll", "yawn", "doze"]);
    expect(beats[0].line).toBeTruthy();
    expect(scrollSeconds(beats)).toBeLessThanOrEqual(12);
  });
});

describe("the night", () => {
  const asleep = (over: Partial<NightState> = {}): NightState => ({ hour: 1, fridge: true, asleepFor: 5, tuckedAgo: null, stirredAgo: null, recent: [], ...over });
  const stirs = (over: Partial<NightState>, count = 2000) => {
    const rand = seeded(13);
    return Array.from({ length: count }, () => nightStir(asleep(over), rand));
  };

  it("has her up now and then from her own sleep, mostly for the fridge", () => {
    const night = stirs({});
    const fridge = night.filter((stir) => stir === "fridge").length;
    const scroll = night.filter((stir) => stir === "scroll").length;
    expect(fridge).toBeGreaterThan(scroll);
    expect(scroll).toBeGreaterThan(50);
    // Mostly she sleeps: about one look at the clock in three.
    expect(fridge + scroll).toBeGreaterThan(450);
    expect(fridge + scroll).toBeLessThan(750);
  });

  it("leaves a Pip the reader tucked in asleep, and only later lets her wander", () => {
    expect(TUCKED_QUIET_MIN).toBeGreaterThanOrEqual(15);
    for (const tuckedAgo of [0, 1, 5, TUCKED_QUIET_MIN - 0.1]) expect(stirs({ tuckedAgo }).every((stir) => stir === null)).toBe(true);
    expect(stirs({ tuckedAgo: TUCKED_QUIET_MIN }).some((stir) => stir !== null)).toBe(true);
    expect(stirs({ tuckedAgo: 90 }).some((stir) => stir !== null)).toBe(true);
  });

  it("never by day: a nap is a nap", () => {
    for (const hour of DAY_HOURS) expect(stirs({ hour }, 300).every((stir) => stir === null)).toBe(true);
  });

  it("not the moment she is asleep, nor again straight after", () => {
    expect(stirs({ asleepFor: STIR_AFTER_MIN - 0.1 }).every((stir) => stir === null)).toBe(true);
    expect(stirs({ stirredAgo: STIR_APART_MIN - 0.1 }).every((stir) => stir === null)).toBe(true);
    expect(stirs({ stirredAgo: STIR_APART_MIN }).some((stir) => stir !== null)).toBe(true);
  });

  it("never for the same thing twice running, and only for what there is", () => {
    expect(stirs({ recent: ["fridge"] })).not.toContain("fridge");
    expect(stirs({ recent: ["scroll"] })).not.toContain("scroll");
    expect(stirs({ fridge: false })).not.toContain("fridge");
    // Early in the evening the phone stays where it is.
    expect(stirs({ hour: 20 })).not.toContain("scroll");
    expect(stirs({ hour: 20 })).toContain("fridge");
  });

  it("takes the phone to bed about every other night, late, and never two nights running", () => {
    const rand = seeded(6);
    const nights = Array.from({ length: 400 }, () => bedtimeScroll(23, [], rand)).filter(Boolean).length;
    expect(nights).toBeGreaterThan(150);
    expect(nights).toBeLessThan(250);
    for (const hour of [...DAY_HOURS, 19, 20]) expect(Array.from({ length: 100 }, () => bedtimeScroll(hour, [], rand)).some(Boolean)).toBe(false);
    expect(Array.from({ length: 100 }, () => bedtimeScroll(23, ["scroll"], rand)).some(Boolean)).toBe(false);
  });
});

describe("what she says", () => {
  it("has a few ways of saying each thing, short and in her own lower case", () => {
    for (const lines of [caughtLine, hintLine, innocentLine, shutOnHerLine, snoozeLine, upLine]) {
      const all = said(lines);
      expect(all.size).toBeGreaterThanOrEqual(3);
      for (const line of all) {
        expect(line).toBe(line.toLowerCase());
        expect(line.length).toBeLessThanOrEqual(44);
      }
    }
    expect(said(innocentLine)).toContain("i was reading.");
  });

  it("says nothing preachy over the phone or the fridge", () => {
    const rand = seeded(1);
    const lines = new Set<string>();
    for (let index = 0; index < 300; index += 1) {
      for (const beat of scrollSession(index % 2 ? 23 : 2, rand)) if (beat.line) lines.add(beat.line);
      for (const step of fridgeVisit(state({ hour: index % 2 ? 23 : 14 }), rand, false).steps) if (step.kind === "do" && step.line) lines.add(step.line);
    }
    expect(lines.size).toBeGreaterThan(20);
    for (const line of lines) {
      expect(line).toBe(line.toLowerCase());
      expect(line.length).toBeLessThanOrEqual(44);
      expect(line).not.toMatch(/should|bad for|too much|screen time|unhealthy/);
    }
  });
});

describe("the small habits", () => {
  it("hits snooze once as day comes, and only then", () => {
    for (const hour of [6, 7, 9, 11]) {
      expect(snoozes(hour, false)).toBe(true);
      expect(snoozes(hour, true)).toBe(false);
    }
    // Not in the night, and not for an afternoon nap.
    for (const hour of [0, 3, 5, 12, 15, 19, 23]) expect(snoozes(hour, false)).toBe(false);
    expect(SNOOZE_S).toBeGreaterThanOrEqual(6);
    expect(SNOOZE_S).toBeLessThanOrEqual(20);
    expect(LIB.some((entry) => entry.id === "snooze")).toBe(true);
  });

  it("looks in the fridge on getting up about one morning in two, where there is one", () => {
    const rand = seeded(4);
    const mornings = Array.from({ length: 400 }, () => morningFridge(true, rand)).filter(Boolean).length;
    expect(mornings).toBeGreaterThan(150);
    expect(mornings).toBeLessThan(250);
    expect(Array.from({ length: 100 }, () => morningFridge(false, rand)).some(Boolean)).toBe(false);
  });

  it("drifts to the phone over a book now and then, catches herself, and the book wins", () => {
    const reads = run(12, 1500, { hour: 15 }).filter((activity) => activity.id === "read");
    const drifted = reads.filter((activity) => moves(activity).includes("phone"));
    expect(reads.length).toBeGreaterThan(100);
    expect(drifted.length).toBeGreaterThan(reads.length * 0.1);
    expect(drifted.length).toBeLessThan(reads.length * 0.3);
    for (const activity of drifted) {
      const done = moves(activity);
      const at = done.indexOf("phone");
      // A book on either side of it, and more of the book after than the phone got.
      expect(done[at - 1]).toBe("read");
      expect(done.slice(at + 1, at + 3)).toEqual(["shift", "read"]);
      const steps = activity.steps.filter((step): step is Extract<Step, { kind: "do" }> => step.kind === "do");
      const phone = steps.find((step) => step.move === "phone");
      const after = steps[steps.findIndex((step) => step.move === "phone") + 2];
      expect(after.seconds).toBeGreaterThan((phone?.seconds ?? 0) * 2);
      expect(steps.find((step) => step.move === "shift")?.line).toBeTruthy();
      expect(busySeconds(activity)).toBeLessThanOrEqual(50);
    }
  });
});
