import { describe, expect, it } from "vitest";
import { LIB } from "./index";
import { seeded } from "./behaviour";
import {
  ANNOYS,
  CROSS_POINTS,
  GLAD_MS,
  GLAD_POINTS,
  HUFF_MS,
  KINDNESS_SHORTENS,
  PATIENCE_AFTER_TANTRUM,
  PATIENCE_FULL,
  PATIENCE_PER_MIN,
  SOOTHES,
  SPELL_MAX_MS,
  SULK_AGAIN,
  SULK_MS,
  SULK_MOVE,
  SULK_POINTS,
  TANTRUM_EVERY_MS,
  TEMPER_MOVES,
  TENDER_FROM,
  TENDER_MS,
  annoy,
  comeRound,
  heartsOff,
  huffing,
  humourOf,
  keepTemper,
  parseTemper,
  soothe,
  spellMinutesLeft,
  spellStrength,
  tantrumPlan,
  temperAt,
  temperStart,
  type Annoyance,
  type Kindness,
  type Temper
} from "./temper";

const MIN = 60_000;
/** A Tuesday afternoon, as the clock has it. */
const T0 = Date.parse("2026-10-13T15:00:00Z");

/** Annoyed by each of these in turn, a second apart, from `now`. */
const vexed = (temper: Temper, whats: Annoyance[], now: number) => {
  let at = now;
  let tantrum: Annoyance | null = null;
  for (const what of whats) {
    at += 1000;
    const next = annoy(temper, what, at);
    temper = next.temper;
    tantrum = next.tantrum ?? tantrum;
  }
  return { temper, tantrum, at };
};

/** A Pip who has just thrown a tantrum about being whirled. */
const sulking = (now = T0) => {
  const { temper, tantrum, at } = vexed(temperStart(now), ["whirled", "whirled", "whirled", "whirled"], now);
  expect(tantrum).toBe("whirled");
  return { temper, at };
};

describe("her patience", () => {
  it("starts full, and a fresh Pip is simply herself", () => {
    const fresh = temperStart(T0);
    expect(fresh.patience).toBe(PATIENCE_FULL);
    expect(humourOf(fresh, T0)).toBeNull();
    expect(heartsOff(fresh, T0)).toBe(0);
  });

  it("is worn down by what is done to her, each by its own amount", () => {
    for (const what of Object.keys(ANNOYS) as Annoyance[]) {
      const { temper, tantrum } = annoy(temperStart(T0), what, T0);
      expect(temper.patience, what).toBe(PATIENCE_FULL - ANNOYS[what]);
      // No one thing is a tantrum by itself, from a Pip in a good temper.
      expect(tantrum, what).toBeNull();
      expect(ANNOYS[what], what).toBeGreaterThan(0);
      expect(ANNOYS[what], what).toBeLessThan(PATIENCE_FULL / 2);
    }
  });

  it("comes back by itself: a poke too many is a flash, gone in a minute or two", () => {
    const { temper } = annoy(temperStart(T0), "poked", T0);
    expect(temper.patience).toBe(80);
    expect(temperAt(temper, T0 + MIN).patience).toBe(80 + PATIENCE_PER_MIN);
    expect(temperAt(temper, T0 + 2 * MIN).patience).toBe(PATIENCE_FULL);
    expect(temperAt(temper, T0 + 60 * MIN).patience).toBe(PATIENCE_FULL);
    // And a clock that went backwards is no time passing.
    expect(temperAt(temper, T0 - 5 * MIN).patience).toBe(80);
  });

  it("is given back by affection, each by its own amount, and never past full", () => {
    const worn = vexed(temperStart(T0), ["whirled", "whirled"], T0);
    for (const what of Object.keys(SOOTHES) as Kindness[]) {
      const before = temperAt(worn.temper, worn.at + 1000).patience;
      const { temper } = soothe(worn.temper, what, worn.at + 1000);
      expect(temper.patience, what).toBeCloseTo(Math.min(PATIENCE_FULL, before + SOOTHES[what]), 5);
    }
    expect(soothe(temperStart(T0), "treat", T0).temper.patience).toBe(PATIENCE_FULL);
  });

  it("shows on the hearts a little as it wears thin, and not at all for one small thing", () => {
    expect(heartsOff(annoy(temperStart(T0), "tossed", T0).temper, T0)).toBeGreaterThanOrEqual(-2);
    const thin = vexed(temperStart(T0), ["whirled", "whirled", "whirled"], T0);
    expect(thin.tantrum).toBeNull();
    expect(heartsOff(thin.temper, thin.at)).toBe(-Math.round((75 / 100) * CROSS_POINTS));
    // And it is back when her patience is.
    expect(heartsOff(thin.temper, thin.at + 10 * MIN)).toBe(0);
  });
});

describe("a tantrum", () => {
  it("starts when her patience runs out, about the last straw", () => {
    const three = vexed(temperStart(T0), ["whirled", "whirled", "whirled"], T0);
    expect(three.tantrum).toBeNull();
    const four = annoy(three.temper, "poked", three.at + 1000);
    expect(four.tantrum).toBe("poked");
    expect(four.temper.tantrumAt).toBe(three.at + 1000);
    expect(four.temper.patience).toBe(PATIENCE_AFTER_TANTRUM);
    expect(humourOf(four.temper, three.at + 1000)).toBe("huff");
  });

  it("takes several of the same thing: whirled four times, sneezed five", () => {
    expect(vexed(temperStart(T0), ["whirled", "whirled", "whirled"], T0).tantrum).toBeNull();
    expect(vexed(temperStart(T0), ["whirled", "whirled", "whirled", "whirled"], T0).tantrum).toBe("whirled");
    expect(vexed(temperStart(T0), ["sneezed", "sneezed", "sneezed", "sneezed"], T0).tantrum).toBeNull();
    expect(vexed(temperStart(T0), ["sneezed", "sneezed", "sneezed", "sneezed", "sneezed"], T0).tantrum).toBe("sneezed");
  });

  it("never comes from things done slowly: her patience keeps up", () => {
    let temper = temperStart(T0);
    for (let minute = 0; minute < 120; minute += 2) {
      const next = annoy(temper, "poked", T0 + minute * MIN);
      expect(next.tantrum).toBeNull();
      temper = next.temper;
    }
  });

  it("is at most one in a while, however hard she is provoked", () => {
    const first = sulking();
    // Left to sulk through the huff, then provoked without a pause for the rest of the eight minutes.
    let temper = first.temper;
    let tantrums = 0;
    for (let at = first.temper.tantrumAt + HUFF_MS + 1000; at < first.temper.tantrumAt + TANTRUM_EVERY_MS; at += 2000) {
      const next = annoy(temper, "whirled", at);
      if (next.tantrum) tantrums += 1;
      temper = next.temper;
    }
    expect(tantrums).toBe(0);
    expect(temperAt(temper, first.temper.tantrumAt + TANTRUM_EVERY_MS - 1).patience).toBeLessThan(1);
    // After that, she can be driven to another.
    const again = annoy(temper, "whirled", first.temper.tantrumAt + TANTRUM_EVERY_MS);
    expect(again.tantrum).toBe("whirled");
  });

  it("takes nothing more while she is in the huff: she is past minding", () => {
    const { temper, at } = sulking();
    const poked = annoy(temper, "poked", at + 5000);
    expect(poked.tantrum).toBeNull();
    expect(poked.temper.patience).toBeCloseTo(temperAt(temper, at + 5000).patience, 5);
  });
});

describe("the sulk after it", () => {
  it("lasts a quarter of an hour to half an hour, by what set her off", () => {
    for (const what of Object.keys(SULK_MS) as Annoyance[]) {
      expect(SULK_MS[what], what).toBeGreaterThanOrEqual(15 * MIN);
      expect(SULK_MS[what], what).toBeLessThanOrEqual(SPELL_MAX_MS);
    }
    expect(SULK_MS.fridge).toBeGreaterThan(SULK_MS.poked);
    const { temper, at } = sulking();
    expect(temper.spell).toMatchObject({ kind: "sulk", cause: "whirled", since: at, ends: at + SULK_MS.whirled, from: 1 });
  });

  it("eases: a huff, then sulking, then merely cool, then herself", () => {
    const { temper, at } = sulking();
    const end = at + SULK_MS.whirled;
    expect(humourOf(temper, at)).toBe("huff");
    expect(huffing(temper, at + HUFF_MS - 1)).toBe(true);
    expect(humourOf(temper, at + HUFF_MS + 1)).toBe("sulk");
    // Still there five minutes on, for a reader who looked away.
    expect(humourOf(temper, at + 5 * MIN)).toBe("sulk");
    expect(humourOf(temper, at + 15 * MIN)).toBe("cool");
    expect(humourOf(temper, end - 1)).toBe("cool");
    expect(humourOf(temper, end)).toBeNull();
    // Gradually, not all at once: weaker each minute after the huff, never stronger.
    let last = 1;
    for (let now = at + HUFF_MS; now <= end; now += MIN) {
      const strength = spellStrength(temper.spell, now);
      expect(strength).toBeLessThanOrEqual(last);
      last = strength;
    }
    expect(last).toBe(0);
  });

  it("shows on the hearts for as long as it lasts, less as it eases", () => {
    const { temper, at } = sulking();
    expect(heartsOff(temper, at + 1000)).toBe(-SULK_POINTS);
    const five = heartsOff(temper, at + 5 * MIN);
    const fifteen = heartsOff(temper, at + 15 * MIN);
    expect(five).toBeLessThan(-20);
    expect(fifteen).toBeLessThan(0);
    expect(fifteen).toBeGreaterThan(five);
    expect(heartsOff(temper, at + SULK_MS.whirled)).toBe(0);
    expect(spellMinutesLeft(temper, at + 5 * MIN)).toBe(15);
    expect(spellMinutesLeft(temper, at + SULK_MS.whirled)).toBe(0);
  });

  it("is longer for a second tantrum within the hour, and never longer than a mood lasts", () => {
    const first = sulking();
    const later = first.temper.tantrumAt + 30 * MIN;
    const second = vexed(first.temper, ["whirled", "whirled", "whirled", "whirled"], later);
    expect(second.tantrum).toBe("whirled");
    const spell = second.temper.spell;
    expect((spell?.ends ?? 0) - (spell?.since ?? 0)).toBe(Math.min(SPELL_MAX_MS, SULK_MS.whirled * SULK_AGAIN));
    // The worst of them, twice, is still half an hour.
    const worst = vexed(first.temper, ["fridge", "fridge", "fridge"], later);
    expect(worst.tantrum).toBe("fridge");
    expect((worst.temper.spell?.ends ?? 0) - (worst.temper.spell?.since ?? 0)).toBe(SPELL_MAX_MS);
  });
});

describe("making up", () => {
  it("is a cuddle or a snack, even in the huff: she comes round, and is tender for a few minutes", () => {
    for (const what of ["cuddle", "treat", "food"] as const) {
      const { temper, at } = sulking();
      const made = soothe(temper, what, at + 20_000);
      expect(made.madeUp, what).toBe(true);
      expect(made.glad, what).toBe(false);
      expect(huffing(made.temper, at + 20_000), what).toBe(false);
      expect(humourOf(made.temper, at + 20_000), what).toBe("cool");
      expect(made.temper.spell?.ends, what).toBe(at + 20_000 + TENDER_MS);
      // Not instantly sunny: the hearts are still down a little, and then they are not.
      expect(heartsOff(made.temper, at + 21_000), what).toBeLessThan(0);
      expect(heartsOff(made.temper, at + 21_000), what).toBeGreaterThanOrEqual(-Math.round(SULK_POINTS * TENDER_FROM));
      expect(heartsOff(made.temper, at + 20_000 + TENDER_MS), what).toBe(0);
    }
  });

  it("shortens it a great deal", () => {
    const { temper, at } = sulking();
    const left = (temper.spell?.ends ?? 0) - (at + 3 * MIN);
    const made = soothe(temper, "cuddle", at + 3 * MIN);
    expect((made.temper.spell?.ends ?? 0) - (at + 3 * MIN)).toBeLessThan(left / 3);
  });

  it("is not a stroke or a dance while she is in the huff, but those shorten the rest of it", () => {
    const { temper, at } = sulking();
    const refused = soothe(temper, "stroke", at + 10_000);
    expect(refused.madeUp).toBe(false);
    expect(refused.temper.spell).toEqual(temper.spell);
    const later = at + 5 * MIN;
    const stroked = soothe(temper, "stroke", later);
    expect(stroked.madeUp).toBe(false);
    expect((stroked.temper.spell?.ends ?? 0) - later).toBeCloseTo(((temper.spell?.ends ?? 0) - later) * (1 - KINDNESS_SHORTENS), 3);
    expect(humourOf(stroked.temper, later)).toBe("sulk");
  });

  it("is said once: kindness to a Pip already made up with is only kindness", () => {
    const { temper, at } = sulking();
    const made = soothe(temper, "cuddle", at + 30_000);
    const again = soothe(made.temper, "treat", at + 60_000);
    expect(again.madeUp).toBe(false);
    expect(again.glad).toBe(false);
    expect(again.temper.spell).toEqual(made.temper.spell);
  });

  it("ends by itself too: left be, the sulk runs out", () => {
    const { temper, at } = sulking();
    expect(temperAt(temper, at + SULK_MS.whirled + 1).spell).toBeNull();
  });
});

describe("a good mood", () => {
  it("follows a snack, a long cuddle, a dance, a game, and food found in a bare fridge, for ten or twenty minutes", () => {
    for (const what of Object.keys(GLAD_MS) as Kindness[]) {
      const lasts = GLAD_MS[what] ?? 0;
      expect(lasts, what).toBeGreaterThanOrEqual(10 * MIN);
      expect(lasts, what).toBeLessThanOrEqual(20 * MIN);
      const { temper, glad } = soothe(temperStart(T0), what, T0);
      expect(glad, what).toBe(true);
      expect(humourOf(temper, T0 + 5 * MIN), what).toBe("glad");
      expect(humourOf(temper, T0 + lasts - 1), what).toBe("glad");
      expect(humourOf(temper, T0 + lasts), what).toBeNull();
    }
    expect(Object.keys(GLAD_MS).sort()).toEqual(["cuddle", "dance", "food", "game", "treat"]);
  });

  it("is not made by the small things: a stroke, a tickle, a high five", () => {
    for (const what of ["stroke", "tickle", "highfive", "fetch", "bed"] as const) expect(soothe(temperStart(T0), what, T0).glad, what).toBe(false);
  });

  it("puts the hearts up for as long as it lasts: all of it for the first half, then easing", () => {
    const { temper } = soothe(temperStart(T0), "treat", T0);
    expect(heartsOff(temper, T0 + 1000)).toBe(GLAD_POINTS);
    expect(heartsOff(temper, T0 + 10 * MIN)).toBe(GLAD_POINTS);
    expect(heartsOff(temper, T0 + 15 * MIN)).toBe(GLAD_POINTS / 2);
    expect(heartsOff(temper, T0 + 20 * MIN)).toBe(0);
  });

  it("is kept going by another kindness, never cut short", () => {
    const treat = soothe(temperStart(T0), "treat", T0).temper;
    const cuddle = soothe(treat, "cuddle", T0 + 2 * MIN).temper;
    expect(cuddle.spell?.ends).toBe(T0 + 20 * MIN);
    const dance = soothe(treat, "dance", T0 + 15 * MIN).temper;
    expect(dance.spell?.ends).toBe(T0 + 27 * MIN);
    expect(heartsOff(dance, T0 + 16 * MIN)).toBe(GLAD_POINTS);
  });

  it("is ended by a tantrum", () => {
    const glad = soothe(temperStart(T0), "treat", T0).temper;
    const { temper, tantrum } = vexed(glad, ["whirled", "whirled", "whirled", "whirled"], T0 + MIN);
    expect(tantrum).toBe("whirled");
    expect(temper.spell?.kind).toBe("sulk");
  });
});

describe("kept on this device", () => {
  it("keeps nothing for a Pip who is simply herself", () => {
    expect(keepTemper(temperStart(T0), T0)).toBeNull();
    // A flash of temper is kept while it lasts, and not after.
    const poked = annoy(temperStart(T0), "poked", T0).temper;
    expect(keepTemper(poked, T0 + 10_000)).not.toBeNull();
    expect(keepTemper(poked, T0 + 5 * MIN)).toBeNull();
  });

  it("survives leaving the room and coming back: the same sulk, as far along as the clock says", () => {
    const { temper, at } = sulking();
    const kept = keepTemper(temper, at + 1000);
    // Five minutes at the camp.
    const back = parseTemper(kept, at + 5 * MIN);
    expect(back.spell).toEqual(temper.spell);
    expect(humourOf(back, at + 5 * MIN)).toBe("sulk");
    expect(heartsOff(back, at + 5 * MIN)).toBe(heartsOff(temper, at + 5 * MIN));
    expect(back.tantrumAt).toBe(temper.tantrumAt);
    // And the app shut and opened again within the time it lasts: the same.
    expect(humourOf(parseTemper(kept, at + 16 * MIN), at + 16 * MIN)).toBe("cool");
  });

  it("survives a good mood too", () => {
    const glad = soothe(temperStart(T0), "treat", T0).temper;
    const back = parseTemper(keepTemper(glad, T0 + 1000), T0 + 12 * MIN);
    expect(humourOf(back, T0 + 12 * MIN)).toBe("glad");
    expect(heartsOff(back, T0 + 12 * MIN)).toBe(heartsOff(glad, T0 + 12 * MIN));
  });

  it("is gone past its time: a reader away for a day never comes back to an old sulk", () => {
    const { temper, at } = sulking();
    const kept = keepTemper(temper, at + 1000);
    for (const away of [SULK_MS.whirled, 60 * MIN, 24 * 60 * MIN, 30 * 24 * 60 * MIN]) {
      const back = parseTemper(kept, at + away);
      expect(back.spell, String(away)).toBeNull();
      expect(humourOf(back, at + away)).toBeNull();
      expect(heartsOff(back, at + away)).toBe(0);
      expect(back.patience).toBe(PATIENCE_FULL);
    }
    // After a day there is nothing left to keep at all.
    expect(keepTemper(parseTemper(kept, at + 24 * 60 * MIN), at + 24 * 60 * MIN)).toBeNull();
  });

  it("reads anything that is not a temper as a fresh one", () => {
    for (const text of [null, "", "nonsense", "[]", "{}", '{"patience":"low"}', '{"patience":50,"at":"then"}']) {
      const read = parseTemper(text, T0);
      expect(read, String(text)).toEqual(temperStart(T0));
    }
    // A clock that was changed: a temper from the future is not believed.
    expect(parseTemper(JSON.stringify({ patience: 10, at: T0 + 60 * MIN, spell: null, tantrumAt: 0 }), T0)).toEqual(temperStart(T0));
  });

  it("does not believe a mood that lasts longer than a mood can, or is of no kind it knows", () => {
    const spell = { kind: "sulk", cause: "whirled", since: T0, holdUntil: T0 + HUFF_MS, ends: T0 + 24 * 60 * MIN, from: 1 };
    expect(parseTemper(JSON.stringify({ patience: 50, at: T0, spell, tantrumAt: T0 }), T0 + MIN).spell).toBeNull();
    for (const bad of [{ ...spell, ends: T0 + 20 * MIN, kind: "furious" }, { ...spell, ends: T0 + 20 * MIN, cause: "tuesdays" }, { ...spell, ends: T0 + 20 * MIN, from: "lots" }, { ...spell, ends: T0 + 20 * MIN, since: T0 + 60 * MIN }]) {
      expect(parseTemper(JSON.stringify({ patience: 50, at: T0, spell: bad, tantrumAt: T0 }), T0 + MIN).spell).toBeNull();
    }
    // One that is in order is believed, with its strength kept to the scale.
    const good = parseTemper(JSON.stringify({ patience: 50, at: T0, spell: { ...spell, ends: T0 + 20 * MIN, from: 7 }, tantrumAt: T0 }), T0 + MIN);
    expect(good.spell).toMatchObject({ kind: "sulk", cause: "whirled", from: 1 });
    expect(good.patience).toBe(50 + PATIENCE_PER_MIN);
  });
});

describe("the performance", () => {
  const moves = new Set(LIB.map((move) => move.id));
  const done = (steps: ReturnType<typeof tantrumPlan>["steps"]) => steps.flatMap((step) => (step.kind === "do" ? [step] : []));

  it("uses only moves she has", () => {
    for (const move of TEMPER_MOVES) expect(moves.has(move), move).toBe(true);
    expect(moves.has(SULK_MOVE)).toBe(true);
    expect(moves.has("stamp")).toBe(true);
  });

  it("is a different one for each thing that sets her off, and always ends with her back turned", () => {
    const seen = new Set<string>();
    for (const cause of Object.keys(ANNOYS) as Annoyance[]) {
      const plan = tantrumPlan(cause, { x: 60, floorW: 240 }, seeded(5));
      expect(plan.id).toBe("tantrum");
      const acts = done(plan.steps);
      expect(acts.length, cause).toBeGreaterThanOrEqual(3);
      expect(acts[acts.length - 1].move, cause).toBe(SULK_MOVE);
      for (const act of acts) {
        expect(moves.has(act.move), `${cause}: ${act.move}`).toBe(true);
        if (act.line) expect(act.line, cause).toBe(act.line.toLowerCase());
      }
      // A little performance, not a long one.
      expect(acts.reduce((sum, act) => sum + act.seconds, 0), cause).toBeLessThanOrEqual(18);
      seen.add(acts.map((act) => `${act.move}:${act.line}`).join("|"));
    }
    expect(seen.size).toBe(Object.keys(ANNOYS).length);
  });

  it("is theatre for a bare fridge, grumpy and sleepy when woken, indignant when dropped", () => {
    expect(done(tantrumPlan("fridge", { x: 60, floorW: 240 }, seeded(1)).steps).map((act) => act.move)).toEqual(["faint", "sob", SULK_MOVE]);
    expect(done(tantrumPlan("woken", { x: 60, floorW: 240 }, seeded(1)).steps).map((act) => act.move)).toEqual(["yawn", "steamed", SULK_MOVE]);
    expect(done(tantrumPlan("dropped", { x: 60, floorW: 240 }, seeded(1)).steps).map((act) => act.move)).toEqual(["steamed", "stamp", SULK_MOVE]);
  });

  it("ends at the nearer wall, facing it; or, woken with a bed to go back to, in bed", () => {
    const left = tantrumPlan("poked", { x: 60, floorW: 240 }, seeded(2)).steps;
    expect(left.find((step) => step.kind === "walk")).toEqual({ kind: "walk", x: 20 });
    expect(left.find((step) => step.kind === "face")).toEqual({ kind: "face", dir: -1 });
    const right = tantrumPlan("poked", { x: 200, floorW: 240 }, seeded(2)).steps;
    expect(right.find((step) => step.kind === "walk")).toEqual({ kind: "walk", x: 220 });
    expect(right.find((step) => step.kind === "face")).toEqual({ kind: "face", dir: 1 });
    const woken = tantrumPlan("woken", { x: 60, floorW: 240, bed: "bed" }, seeded(2)).steps;
    expect(woken[woken.length - 1]).toEqual({ kind: "use", id: "bed", what: "bed" });
    expect(woken.some((step) => step.kind === "walk")).toBe(false);
  });

  it("is a line and a pose with motion reduced, not a performance", () => {
    for (const cause of Object.keys(ANNOYS) as Annoyance[]) {
      const plan = tantrumPlan(cause, { x: 60, floorW: 240, bed: "bed", reduced: true }, seeded(3));
      expect(plan.steps, cause).toHaveLength(1);
      expect(plan.steps[0]).toMatchObject({ kind: "do", move: SULK_MOVE });
      expect((plan.steps[0] as { line?: string }).line, cause).toBeTruthy();
    }
  });

  it("comes round visibly: a sniff, a look over her shoulder, and a word; or, the huff simply over, the look and a grudging one", () => {
    const made = comeRound(true, seeded(4));
    expect(done(made.steps).map((act) => act.move)).toEqual(["sniffle", "glance", "shift"]);
    expect(done(made.steps)[2].line).toBeTruthy();
    expect(done(comeRound(false, seeded(4)).steps).map((act) => act.move)).toEqual(["glance", "shift"]);
    // Without motion: no sniff, the look and the word.
    expect(done(comeRound(true, seeded(4), true).steps).map((act) => act.move)).toEqual(["glance", "shift"]);
  });
});
