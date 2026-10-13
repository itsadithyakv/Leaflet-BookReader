import { describe, expect, it } from "vitest";
import { LIB } from "./index";
import { FOUND_BARE, FOUND_FOOD, fidget, fridgeVisit, seeded, weights, type BehaviourState, type Step, type World } from "./behaviour";
import { BARE_DROOPS_PER_DAY, BARE_DROOP_GAP_MS, FRIDGE_HOW_BARE, FRIDGE_HOW_STOCKED, bareFound, bareMinds, bareSeenStart, foodFound, fridgeHolds, parseBareSeen } from "./furnish";
import { explainMood, type MoodInputs } from "./mood";
import { fridgeIsBare, pipService, type PipFridge } from "../services/pipService";

/**
 * Her fridge, since 2026-10-13: stocked by the snacks bought, bare without
 * them. Rust works out which (pip/fridge.rs, tested there); this is the
 * webview's part: how often she droops over a bare one, what she does when
 * she looks, what the mood panel says, and the browser preview's copy of the
 * rule.
 */

const HOUR = 3_600_000;
const NOON = Date.parse("2026-10-13T12:00:00Z");

describe("whether the fridge is bare, as the webview reads Rust's answer", () => {
  const fridge = (stockedUntil: string | null): PipFridge => ({ stockedUntil, mindedToday: false, hoursPerSnack: 24, maxHours: 72 });

  it("is bare with nothing bought, and once the food has run out", () => {
    expect(fridgeIsBare(fridge(null), NOON)).toBe(true);
    expect(fridgeIsBare(fridge("2026-10-13T11:59:59Z"), NOON)).toBe(true);
    expect(fridgeIsBare(fridge("2026-10-13T12:00:00Z"), NOON)).toBe(true);
    expect(fridgeIsBare(fridge("not a time"), NOON)).toBe(true);
  });

  it("is stocked until then, so a fridge that empties while the tab is open is seen to", () => {
    const until = fridge("2026-10-13T18:00:00Z");
    expect(fridgeIsBare(until, NOON)).toBe(false);
    expect(fridgeIsBare(until, NOON + 6 * HOUR - 1)).toBe(false);
    expect(fridgeIsBare(until, NOON + 6 * HOUR)).toBe(true);
  });

  it("says which in its label and its tooltip", () => {
    expect(fridgeHolds(true)).toBe("nothing in it");
    expect(fridgeHolds(false)).toBe("food in it");
    expect(FRIDGE_HOW_BARE).toMatch(/bare/);
    expect(FRIDGE_HOW_STOCKED).toMatch(/food/);
  });
});

describe("how often she droops over a bare fridge", () => {
  it("is a couple of times a day at the very most, and not twice in an afternoon", () => {
    expect(BARE_DROOPS_PER_DAY).toBe(2);
    let seen = bareSeenStart();
    expect(bareMinds(seen, "2026-10-13", NOON)).toBe(true);
    seen = bareFound(seen, "2026-10-13", NOON);
    expect(seen).toMatchObject({ day: "2026-10-13", times: 1, wasBare: true });
    // Not again for a few hours.
    expect(bareMinds(seen, "2026-10-13", NOON + 60_000)).toBe(false);
    expect(bareMinds(seen, "2026-10-13", NOON + BARE_DROOP_GAP_MS - 1)).toBe(false);
    expect(bareMinds(seen, "2026-10-13", NOON + BARE_DROOP_GAP_MS)).toBe(true);
    seen = bareFound(seen, "2026-10-13", NOON + BARE_DROOP_GAP_MS);
    expect(seen.times).toBe(2);
    // And then not at all, however long the day is.
    expect(bareMinds(seen, "2026-10-13", NOON + 11 * HOUR)).toBe(false);
  });

  it("starts again with the day", () => {
    let seen = bareFound(bareFound(bareSeenStart(), "2026-10-13", NOON), "2026-10-13", NOON + 4 * HOUR);
    expect(bareMinds(seen, "2026-10-14", NOON + 12 * HOUR)).toBe(true);
    seen = bareFound(seen, "2026-10-14", NOON + 12 * HOUR);
    expect(seen).toMatchObject({ day: "2026-10-14", times: 1 });
  });

  it("remembers that she found it bare until she finds food in it", () => {
    const seen = bareFound(bareSeenStart(), "2026-10-13", NOON);
    expect(seen.wasBare).toBe(true);
    expect(foodFound(seen).wasBare).toBe(false);
    expect(foodFound(seen).times).toBe(1);
  });

  it("is read back as it was kept, and anything else as never", () => {
    const seen = bareFound(bareSeenStart(), "2026-10-13", NOON);
    expect(parseBareSeen(JSON.stringify(seen))).toEqual(seen);
    for (const text of [null, "", "nonsense", "[]", "7"]) expect(parseBareSeen(text), String(text)).toEqual(bareSeenStart());
    expect(parseBareSeen('{"day":"tuesday","times":"lots","at":-5,"wasBare":"yes"}')).toEqual(bareSeenStart());
  });
});

describe("what she does at the fridge", () => {
  const moves = new Set(LIB.map((move) => move.id));
  const state = (world: World, extra: Partial<BehaviourState> = {}): BehaviourState => ({
    mood: 70,
    hour: 14,
    floor: { w: 240, garden: false, arcade: false },
    x: 60,
    spots: [
      { kind: "fridge", x: 175, w: 12, id: "bedroom/fixture:minifridge" },
      { kind: "bed", x: 50, w: 42, id: "bed" }
    ],
    toys: [],
    dances: [],
    signature: "read",
    hobbies: [],
    recent: [],
    world,
    ...extra
  });
  const done = (steps: readonly Step[]) => steps.flatMap((step) => (step.kind === "do" ? [step.move] : []));
  const told = (steps: readonly Step[]) => steps.flatMap((step) => (step.kind === "use" && step.what === "thing" ? [step.verb] : []));
  const every = (world: World, check: (steps: Step[], seed: number) => void) => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const visit = fridgeVisit(state(world), seeded(seed), false);
      for (const step of visit.steps) if (step.kind === "do") expect(moves.has(step.move), step.move).toBe(true);
      check(visit.steps, seed);
    }
  };

  it("finds it bare, droops, and gets no snack; and the scene is told as she looks", () => {
    every({ fridge: { bare: true } }, (steps) => {
      expect(done(steps)).toEqual(["fridge-stare", "mope", "shift"]);
      expect(told(steps)).toEqual([FOUND_BARE]);
      expect(done(steps)).not.toContain("nibble");
      const mope = steps.find((step) => step.kind === "do" && step.move === "mope");
      expect(mope && mope.kind === "do" ? mope.line : null).toBeTruthy();
      // The door she opened is shut again.
      expect(steps.filter((step) => step.kind === "use" && step.what === "shut")).toHaveLength(1);
    });
  });

  it("only looks, once she has drooped as often as she will: nothing is told, so nothing is taken", () => {
    every({ fridge: { bare: true, resigned: true } }, (steps) => {
      expect(done(steps)).toEqual(["fridge-stare", "shift"]);
      expect(told(steps)).toEqual([]);
    });
  });

  it("finds food and always has a little of it", () => {
    every({ fridge: { bare: false } }, (steps) => {
      expect(done(steps)).toEqual(["fridge-stare", "nibble", "bop"]);
      expect(told(steps)).toEqual([FOUND_FOOD]);
    });
  });

  it("is visibly pleased the first time she finds food in a fridge that was bare", () => {
    every({ fridge: { bare: false, wasBare: true } }, (steps) => {
      expect(done(steps)).toEqual(["fridge-stare", "cheer", "nibble", "bop"]);
      const cheer = steps.find((step) => step.kind === "do" && step.move === "cheer");
      expect(cheer && cheer.kind === "do" ? cheer.line : null).toMatch(/food|full|filled/);
    });
  });

  it("goes back to bed after a look in the night, bare or not", () => {
    for (const fridge of [{ bare: true }, { bare: false }, { bare: true, resigned: true }]) {
      const steps = fridgeVisit(state({ fridge }, { hour: 2 }), seeded(3), true).steps;
      expect(steps[steps.length - 1]).toEqual({ kind: "use", id: "bed", what: "bed" });
    }
  });

  it("is the old look, for show, where nothing is said of the fridge", () => {
    every({}, (steps) => {
      expect(told(steps)).toEqual([]);
      expect(done(steps)).not.toContain("mope");
    });
  });

  it("is over to look before long once it is stocked again, and seldom once she is done drooping", () => {
    const plain = weights(state({})).fridge;
    expect(weights(state({ fridge: { bare: false } })).fridge).toBe(plain);
    expect(weights(state({ fridge: { bare: true } })).fridge).toBe(plain);
    expect(weights(state({ fridge: { bare: true, resigned: true } })).fridge).toBeLessThan(plain);
    expect(weights(state({ fridge: { bare: false, wasBare: true } })).fridge).toBeGreaterThan(plain * 5);
  });
});

describe("the mood she is in, in what she chooses", () => {
  const state = (world: World): BehaviourState => ({
    mood: 70,
    hour: 14,
    floor: { w: 240, garden: false, arcade: false },
    x: 60,
    spots: [{ kind: "window", x: 150, w: 36, up: true, id: "window" }],
    toys: ["treat-ball"],
    dances: ["floss"],
    signature: "read",
    hobbies: [],
    recent: [],
    world
  });

  it("keeps a sulking Pip to herself, and puts a spring in a glad one", () => {
    const plain = weights(state({}));
    const sulk = weights(state({ humour: "sulk" }));
    const glad = weights(state({ humour: "glad" }));
    expect(sulk.dance).toBe(0);
    expect(sulk.toy).toBe(0);
    expect(sulk.exercise).toBe(0);
    expect(sulk.window).toBeGreaterThan(plain.window);
    expect(glad.dance).toBeGreaterThan(plain.dance);
    expect(glad.toy).toBeGreaterThan(plain.toy);
    expect(glad.nap).toBeLessThan(plain.nap);
    const cool = weights(state({ humour: "cool" }));
    expect(cool.dance).toBeLessThan(plain.dance);
    expect(cool.dance).toBeGreaterThan(0);
    // A tantrum is thrown, never chosen.
    for (const w of [plain, sulk, glad, cool]) expect(w.tantrum).toBe(0);
  });

  it("shows in the small things too: a droop and a look over her shoulder, or a hum", () => {
    const seen = (world: World) => {
      const all = new Set<string>();
      for (let seed = 1; seed <= 200; seed += 1) all.add(fidget({ mood: 70, hour: 14, world }, null, seeded(seed)).move);
      return all;
    };
    const sulk = seen({ humour: "sulk" });
    expect(sulk.has("mope")).toBe(true);
    expect(sulk.has("glance")).toBe(true);
    expect(sulk.has("bop")).toBe(false);
    expect(sulk.has("stretch")).toBe(false);
    const glad = seen({ humour: "glad" });
    expect(glad.has("bop")).toBe(true);
    expect(glad.has("cheer")).toBe(true);
    expect(glad.has("mope")).toBe(false);
    expect(seen({ humour: "cool" }).has("bop")).toBe(false);
    expect(seen({}).has("mope")).toBe(false);
  });
});

describe("what the mood panel says of it", () => {
  const rules = { driftPerDay: 8, driftFloor: 40, perReadingMinute: 0.25, readingPerDay: 10, perSession: 5, perHarvest: 2, perGame: 3, perPlay: 1, playPerDay: 12, perWish: 10, start: 70, bareFridge: 3 };
  const input = (extra: Partial<MoodInputs>): MoodInputs => ({
    mood: 70,
    moodUpdatedAt: new Date(NOON - 60_000).toISOString(),
    now: NOON,
    rules,
    log: [],
    playToday: 0,
    readingToday: 0,
    sessionsToday: 0,
    minutesToday: 0,
    wish: null,
    ripe: 0,
    snack: { name: "an Apple", price: 4, mood: 5 },
    treatName: (id) => id,
    gameName: (id) => id,
    ...extra
  });
  const line = (report: ReturnType<typeof explainMood>, id: string) => report.why.find((entry) => entry.id === id);

  it("says a bare fridge is bare, what it costs and when, and what mends it", () => {
    const bare = explainMood(input({ fridge: { bare: true, hoursLeft: 0, mindedToday: false, hoursPerSnack: 24, maxHours: 72 } }));
    expect(line(bare, "fridge")).toMatchObject({ tone: "down" });
    expect(line(bare, "fridge")?.text).toMatch(/bare/);
    expect(line(bare, "fridge")?.text).toMatch(/takes 3: once a day at most, never below 40, and never while Leaflet is shut/);
    expect(line(bare, "fridge")?.text).toMatch(/A snack stocks it for about a day\./);
    expect(bare.lifts.find((lift) => lift.id === "snack")?.text).toMatch(/and it stocks her fridge/);
    expect(bare.rule).toMatch(/Finding her fridge bare takes 3/);
    const minded = explainMood(input({ fridge: { bare: true, hoursLeft: 0, mindedToday: true, hoursPerSnack: 24, maxHours: 72 } }));
    expect(line(minded, "fridge")?.text).toMatch(/takes no more today/);
  });

  it("says how long the food will last when there is some, and nothing of a fridge nobody has told it about", () => {
    const stocked = explainMood(input({ fridge: { bare: false, hoursLeft: 30, mindedToday: false, hoursPerSnack: 24, maxHours: 72 } }));
    expect(line(stocked, "fridge")).toEqual({ id: "fridge", tone: "plain", text: "There is food in her fridge for about a day more." });
    expect(stocked.lifts.find((lift) => lift.id === "snack")?.text).not.toMatch(/fridge/);
    expect(explainMood(input({ fridge: { bare: false, hoursLeft: 5.2, mindedToday: false, hoursPerSnack: 24, maxHours: 72 } })).why.find((entry) => entry.id === "fridge")?.text).toBe("There is food in her fridge for about 5 hours more.");
    const none = explainMood(input({}));
    expect(line(none, "fridge")).toBeUndefined();
    expect(none.rule).not.toMatch(/fridge/);
  });

  it("says what took her mood down, when the last thing did", () => {
    const report = explainMood(input({ log: [{ at: new Date(NOON - 3 * HOUR).toISOString(), cause: "fridge", gain: -3, mood: 67 }] }));
    expect(report.last).toBe("Finding her fridge bare took 3 off her mood, 3 hours ago.");
    const cheered = explainMood(input({ log: [{ at: new Date(NOON - 3 * HOUR).toISOString(), cause: "treat:apple", gain: 5, mood: 75 }] }));
    expect(cheered.last).toBe("apple cheered her up by 5, 3 hours ago.");
  });

  it("says the mood she is in, and that the hearts show it without the number changing", () => {
    const sulk = explainMood(input({ temper: { off: -22, humour: "sulk", minutesLeft: 14 } }));
    expect(sulk.level).toBe(70);
    expect(sulk.felt).toBe(48);
    expect(sulk.word).toBe("Content");
    expect(sulk.headline).toMatch(/^Content for now: the hearts show 48 out of 100 \(70 without the mood she is in\)\. She is sulking: the hearts show 22 less for about 14 more minutes\./);
    expect(line(sulk, "temper")).toMatchObject({ tone: "down" });
    expect(sulk.rule).toMatch(/run out by the clock/);
    const huff = explainMood(input({ temper: { off: -30, humour: "huff", minutesLeft: 20 } }));
    expect(line(huff, "temper")?.text).toMatch(/a cuddle or a snack makes it up sooner/);
    const glad = explainMood(input({ temper: { off: 20, humour: "glad", minutesLeft: 18 } }));
    expect(glad.felt).toBe(90);
    expect(line(glad, "temper")).toEqual({ id: "temper", tone: "up", text: "She is in a good mood: the hearts show 20 more for about 18 more minutes." });
    const thin = explainMood(input({ temper: { off: -8, humour: null, minutesLeft: 0 } }));
    expect(line(thin, "temper")?.text).toBe("Her patience is thin just now: the hearts show 8 less. It comes back in a minute or two.");
  });

  it("says nothing of a temper that is doing nothing, and reads as it always did", () => {
    const calm = explainMood(input({ temper: { off: 0, humour: null, minutesLeft: 0 } }));
    expect(line(calm, "temper")).toBeUndefined();
    expect(calm.felt).toBe(calm.level);
    expect(calm.headline).toMatch(/^Happy: 70 out of 100\./);
  });
});

describe("the browser preview's copy of the rule", () => {
  it("has a fridge that is always bare (nothing can be bought there), and takes a little once a day, as Rust does", async () => {
    const before = await pipService.overview();
    expect(before.fridge).toMatchObject({ stockedUntil: null, mindedToday: false, hoursPerSnack: 24, maxHours: 72 });
    expect(before.moodRules.bareFridge).toBe(3);
    const after = await pipService.fridgeBare();
    expect(after.state.mood).toBeCloseTo(before.state.mood - 3, 2);
    expect(after.fridge?.mindedToday).toBe(true);
    expect(after.moodLog[after.moodLog.length - 1]).toMatchObject({ cause: "fridge" });
    expect(after.moodLog[after.moodLog.length - 1].gain).toBeCloseTo(-3, 2);
    // Again the same day: nothing more.
    const again = await pipService.fridgeBare();
    expect(again.state.mood).toBeCloseTo(after.state.mood, 2);
    expect(again.moodLog).toHaveLength(after.moodLog.length);
  });
});
