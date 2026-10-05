import { describe, expect, it } from "vitest";
import { EMPTY_SNAPSHOT, type PipCold } from "../services/habitService";
import { COLD_LINES, CURED_LINES, coldAfterSession, coldLevel, coldWords } from "./cold";

const cold = (over: Partial<PipCold> = {}): PipCold => ({
  since: "2026-10-10",
  brokeFrom: 12,
  cure: 0,
  minutesLeftToday: 20,
  daysLeft: 3,
  ...over
});

describe("the cold as a number to draw from", () => {
  it("is nothing when she is well", () => {
    expect(coldLevel(null)).toBe(0);
    expect(coldLevel(undefined)).toBe(0);
    expect(coldLevel(EMPTY_SNAPSHOT.cold)).toBe(0);
  });

  it("eases as today's reading nears the goal, and never below a sniffle while she has it", () => {
    expect(coldLevel(cold())).toBe(1);
    expect(coldLevel(cold({ cure: 0.6 }))).toBeCloseTo(0.4);
    expect(coldLevel(cold({ cure: 0.96 }))).toBe(0.15);
    // Numbers that should not arrive, held in range.
    expect(coldLevel(cold({ cure: -1 }))).toBe(1);
    expect(coldLevel(cold({ cure: 7 }))).toBe(0.15);
  });
});

describe("the cold in words", () => {
  it("says why she has it, and that nothing was taken", () => {
    const words = coldWords(cold());
    expect(words.headline).toBe("Pip has a cold.");
    expect(words.why).toBe("Your 12-day streak ended on Sat 10 Oct. Nothing was taken from your shelf for it: she caught a cold instead.");
    expect(words.mood).toBe("A cold is not her mood: it lowers nothing and takes nothing.");
  });

  it("says what cures it with today's numbers", () => {
    expect(coldWords(cold()).lift).toBe("Read 20 minutes today (your daily goal), in a focus session or not, and the cold is gone.");
    expect(coldWords(cold({ cure: 0.6, minutesLeftToday: 8 })).lift).toBe(
      "She is 60% of the way better. 8 more minutes of reading today, in a focus session or not, and the cold is gone."
    );
    // Never "100%" while she still has it, and never "0 minutes".
    expect(coldWords(cold({ cure: 0.999, minutesLeftToday: 1 })).lift).toBe(
      "She is 99% of the way better. 1 more minute of reading today, in a focus session or not, and the cold is gone."
    );
    expect(coldWords(cold({ cure: 0.5, minutesLeftToday: 0 })).lift).toContain("1 more minute of");
  });

  it("says that it passes by itself, and when", () => {
    expect(coldWords(cold({ daysLeft: 3 })).passes).toBe("It passes by itself in 3 days.");
    expect(coldWords(cold({ daysLeft: 2 })).passes).toBe("It passes by itself in 2 days.");
    expect(coldWords(cold({ daysLeft: 1 })).passes).toBe("It passes by itself tomorrow.");
  });

  it("never mentions burning, losing or a cost", () => {
    for (const each of [cold(), cold({ cure: 0.4, minutesLeftToday: 12, daysLeft: 1 })]) {
      const said = Object.values(coldWords(each)).join(" ").toLowerCase();
      expect(said).not.toMatch(/burn|lost|lose|cost|penalt|punish/);
    }
  });
});

describe("the end of a session", () => {
  it("says the session's reading cured her", () => {
    expect(coldAfterSession(null, true)).toBe("Pip's cold is gone. Your reading nursed her back.");
  });

  it("says how much more would, while she still has it", () => {
    expect(coldAfterSession(cold({ cure: 0.6, minutesLeftToday: 8 }), false)).toBe(
      "Pip still has a cold. 8 more minutes of reading today and she is better."
    );
    expect(coldAfterSession(cold({ cure: 0.95, minutesLeftToday: 1 }), false)).toBe(
      "Pip still has a cold. 1 more minute of reading today and she is better."
    );
  });

  it("says nothing when there is no cold", () => {
    expect(coldAfterSession(null, false)).toBeNull();
    expect(coldAfterSession(undefined, false)).toBeNull();
  });
});

describe("her lines", () => {
  it("are lower case and fit her bubble", () => {
    for (const line of [...COLD_LINES, ...CURED_LINES]) {
      expect(line).toBe(line.toLowerCase());
      expect(line.length).toBeLessThanOrEqual(44);
    }
  });
});
