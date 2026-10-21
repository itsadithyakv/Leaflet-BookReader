import { describe, expect, it } from "vitest";
import { ACORNS_A_MINUTE, STRETCH_MINUTES, hides, holds, newBase, oakDrops, parcelGives, type BaseState, type BuildingId } from "../../../../pip/base/rules";
import { acornCard, acornsAMinute, charmCard, parcelCard } from "./currency";

const DAY = "2026-10-19";
const camp = (change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}): BaseState => {
  const base = newBase(1000, DAY);
  return { ...base, acorns: 55, ...change, levels: { ...base.levels, burrow: 1, oak: 1, store: 1, ...levels } };
};

describe("the acorns chip's card", () => {
  it("says what reading earns, from the oak's own figures: 8 every ten minutes at its first level, 0.8 a minute", () => {
    const card = acornCard(camp());
    expect(oakDrops(camp())).toBe(8);
    expect(acornsAMinute(camp())).toBeCloseTo(0.8);
    expect(card.title).toBe("Acorns");
    expect(card.earn[0].text).toBe(`About 0.8 for every minute you read: the oak drops 8 every 10 minutes. Tap the oak to collect them: it keeps them all until you do.`);
    // A bigger oak, and a week's streak: more of both.
    const grown = acornCard(camp({}, { oak: 3, burrow: 3 }), 7);
    expect(grown.earn[0].text).toMatch(/^About 2\.4 for every minute you read: the oak drops 24 every 10 minutes/);
    expect(grown.earn[1].text).toBe("Your 7-day reading streak adds 20% to the oak.");
  });

  it("says what a streak would add when there is none yet, and what a parcel brings and when", () => {
    const card = acornCard(camp(), 0);
    expect(card.earn[1].text).toBe("A 3-day reading streak adds 10% to the oak.");
    expect(card.earn[2].text).toBe(`A sitting of ${STRETCH_MINUTES} minutes or more, or a day's goal met, sends a parcel: ${parcelGives(camp())} acorns.`);
    expect(STRETCH_MINUTES).toBe(8);
  });

  it("says nothing holds them (1.5.10): the larder only keeps a share safe from prowlers", () => {
    expect(holds(camp())).toBe(Infinity);
    expect(acornCard(camp()).cap).toBe(`Your larder keeps ${hides(camp())} of them safe from prowlers.`);
    expect(acornCard(camp()).more).toBe("store");
    expect(acornCard(camp({}, { store: 0 })).cap).toBeNull();
    expect(acornCard(camp({}, { store: 5 })).more).toBeNull();
  });

  it("speaks of acorns alone: reading is how they are earned, never a second price", () => {
    const all = JSON.stringify(acornCard(camp({}, { hut: 1 }), 3));
    expect(all).not.toMatch(/seed/i);
    expect(all).not.toMatch(/minutes of reading/i);
    expect(all).toMatch(/Raids on the magpies bring acorns home/);
    // The work a building used to want in reading is in its price, at half an acorn a minute.
    expect(ACORNS_A_MINUTE).toBe(0.5);
  });
});

describe("the charm chip's card", () => {
  it("says what charm is and the next animal it brings", () => {
    const card = charmCard(camp({ decor: [{ kind: 0, x: 100, y: 100 }] }, { burrow: 3 }));
    expect(card.lead).toBe("How charming the camp is: 2. Not spent; it only grows.");
    expect(card.earn[1].text).toMatch(/^It brings animals to the meadow: the .+ comes at \d+\.$/);
  });
});

describe("the parcels chip's card", () => {
  it("says why they wait when the larder is full, and what one brings", () => {
    const card = parcelCard(camp({ parcels: 3, acorns: 150 }), 0);
    expect(card.lead).toBe("3 parcels wait by the burrow's door: the larder is full. Each goes in whole, so it waits for room.");
    expect(card.earn[0].text).toMatch(/sends one: \d+ acorns\.$/);
    expect(card.more).toBe("store");
  });
});
