import { describe, expect, it } from "vitest";
import { SKINS } from "../../pip";
import { EXTRA_PLOTS, FREE_SIGNATURES, PREMIUM_MOVES, RARE_LEVELS, SOUNDS, accessories, catalogue, treats, type ShopKind } from "../../pip/shop";
import { houseLevels, type LevelDecor } from "../../pip/home.js";
import { shopEntries } from "./shopEntries";

/** The shop's shelves for a reader who owns `owned` ("kind:id"), at a level. */
const shelves = (readerLevel: number | undefined, owned: string[] = []) => {
  const levels = houseLevels();
  const never = () => undefined;
  return shopEntries({
    owns: (kind: ShopKind, id: string) => owned.includes(`${kind}:${id}`),
    variant: "sprout",
    outfit: [],
    skin: SKINS.find((skin) => skin.id === "sprout"),
    signature: "read",
    wearing: () => false,
    withAccessory: (id) => [id],
    spendable: 100000,
    books: [],
    where: new Map(),
    level: levels[0],
    levels,
    decor: { wallpaper: null, floor: null, placed: [] } as LevelDecor,
    house: false,
    placeable: () => true,
    unlocked: () => true,
    lockReason: () => null,
    change: async () => undefined,
    setFinish: async () => undefined,
    closeShop: never,
    startDecorating: never,
    placeFromShop: never,
    goToFloor: never,
    give: async () => undefined,
    ...(readerLevel === undefined ? {} : { readerLevel })
  });
};

const everything = (readerLevel?: number, owned: string[] = []) => shelves(readerLevel, owned).shopCategories.flatMap((category) => category.entries);

describe("what the shop's shelves leave out", () => {
  it("has no tile for the streak freeze or for a sound, in any tab", () => {
    const { shopCategories, entryFor } = shelves(1);
    for (const category of shopCategories) {
      for (const entry of category.entries) {
        expect(entry.kind, `${category.id}: ${entry.id}`).not.toBe("freeze");
        expect(entry.kind, `${category.id}: ${entry.id}`).not.toBe("sound");
      }
    }
    expect(entryFor("freeze", "freeze")).toBeNull();
    for (const sound of SOUNDS) expect(entryFor("sound", sound.id)).toBeNull();
    // They are in the catalogue all the same: it is the shelves that pass them by.
    expect(catalogue().some((item) => item.kind === "freeze")).toBe(true);
    expect(catalogue().filter((item) => item.kind === "sound").length).toBe(SOUNDS.length);
  });

  it("counts neither in any tally: each tab's total is its own things and no more", () => {
    const { tallies } = shelves(1);
    expect(tallies.variants.total).toBe(SKINS.length);
    expect(tallies.wardrobe.total).toBe(accessories().length);
    expect(tallies.treats.total).toBe(treats().filter((treat) => treat.kind === "toy").length);
    expect(tallies.moves.total).toBe(FREE_SIGNATURES.length + PREMIUM_MOVES.length);
    expect(tallies.house.total).toBeGreaterThanOrEqual(EXTRA_PLOTS.length);
  });

  it("counts nothing more for a reader who owns a sound and has bought freezes", () => {
    const plain = shelves(1).tallies;
    const withThem = shelves(1, ["sound:crickets", "sound:train", "freeze:freeze"]).tallies;
    expect(withThem).toEqual(plain);
  });

  it("counts the rare things in the wardrobe: they are worn, and collected like the rest", () => {
    const rareWorn = RARE_LEVELS.filter((entry) => entry.kind === "accessory");
    expect(shelves(1, [`accessory:${rareWorn[0].id}`]).tallies.wardrobe.owned).toBe(1);
    expect(accessories().filter((item) => rareWorn.some((entry) => entry.id === item.id)).length).toBe(rareWorn.length);
  });
});

describe("rare things on the shelves", () => {
  const rareKeys = RARE_LEVELS.map((entry) => `${entry.kind}:${entry.id}`);

  it("are locked for a new reader, saying only the level, with the rest in a tooltip", () => {
    for (const gate of RARE_LEVELS) {
      const entry = everything(1).find((candidate) => candidate.kind === gate.kind && candidate.id === gate.id);
      expect(entry, gate.id).toBeDefined();
      expect(entry?.locked).toBe(`Level ${gate.level}`);
      expect(entry?.lockedHint).toBe(`Opens at level ${gate.level}. Seeds you earn count, spent or not.`);
      expect(entry?.level).toBe(gate.level);
      expect(entry?.price).toBeGreaterThan(0);
      // It can still be tried on, which is half the point of seeing it.
      expect(entry?.preview).toBeTruthy();
    }
  });

  it("open one by one as the level comes", () => {
    const open = (level: number) =>
      everything(level)
        .filter((entry) => entry.level && !entry.locked)
        .map((entry) => entry.id)
        .sort();
    const reached = (level: number) => RARE_LEVELS.filter((gate) => gate.level <= level).map((gate) => gate.id).sort();
    for (const level of [1, 2, 3, 4, 5, 8, 9, 10, 12, 15, 16, 20, 99]) expect(open(level), `level ${level}`).toEqual(reached(level));
    expect(open(2)).toEqual([]);
    expect(open(99).length).toBe(RARE_LEVELS.length);
  });

  it("read a missing level as level 1", () => {
    // No level given: it comes from the store, which has no overview here.
    expect(everything(undefined).filter((entry) => entry.level && !entry.locked)).toEqual([]);
  });

  it("are never locked once owned, whatever the level says now", () => {
    const gate = RARE_LEVELS[RARE_LEVELS.length - 1];
    const entry = everything(1, [`${gate.kind}:${gate.id}`]).find((candidate) => candidate.id === gate.id);
    expect(entry?.owned).toBe(true);
    expect(entry?.locked ?? null).toBeNull();
    expect(entry?.level).toBe(gate.level);
  });

  it("stand together under one heading, after everything else in their tab, in the order they open", () => {
    for (const category of shelves(1, ["accessory:cap", "accessory:quill"]).shopCategories) {
      const rare = category.entries.filter((entry) => entry.level);
      if (rare.length === 0) continue;
      const firstRare = category.entries.findIndex((entry) => entry.level);
      expect(category.entries.slice(firstRare).every((entry) => entry.level), category.id).toBe(true);
      expect(rare.every((entry) => entry.group === "Rare")).toBe(true);
      expect(category.entries.slice(0, firstRare).every((entry) => entry.group !== "Rare")).toBe(true);
      const levels = rare.map((entry) => entry.level ?? 0);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
    }
    expect(everything(1).filter((entry) => entry.level).map((entry) => `${entry.kind}:${entry.id}`).sort()).toEqual([...rareKeys].sort());
  });

  it("lock nothing that has no level", () => {
    const common = everything(1).filter((entry) => entry.kind === "accessory" && !entry.level);
    expect(common.length).toBeGreaterThan(30);
    expect(common.every((entry) => !entry.locked && !entry.lockedHint)).toBe(true);
  });
});
