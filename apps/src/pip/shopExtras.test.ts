import { describe, expect, it } from "vitest";
import rustCatalogue from "../../src-tauri/src/pip/catalogue.json?raw";
import { ACCESSORIES } from "./core";
import { PACING, RARE_LEVELS, SETS, SOUNDS, STREAK_FREEZE, WISH, accessoryPrice, catalogue, catalogueItem, levelFor, levelStart } from "./shop";
import { pipService } from "../services/pipService";

/** What Rust reads: the generated copy of the catalogue (scripts/pip-catalogue.mjs). */
type RustItem = { kind: string; id: string; price: number; consumable?: boolean; level?: number; slot?: string };
const rust = JSON.parse(rustCatalogue) as {
  items: RustItem[];
  sets: Array<{ id: string; kind: string; items: string[] }>;
  wish: { eras: Array<Record<string, unknown>> };
};
const rustItem = (kind: string, id: string) => rust.items.find((item) => item.kind === kind && item.id === id);

const items = catalogue();
const wished = WISH.eras.flatMap((era) => (["treat", "plant", "room", "move"] as const).flatMap((kind) => era[kind].map((id) => `${kind}:${id}`)));
const inSets = SETS.flatMap((set) => set.items.map((id) => `${set.kind}:${id}`));

describe("the streak freeze in the catalogue", () => {
  it("is one thing, bought each time, at its price", () => {
    const freezes = items.filter((item) => item.kind === "freeze");
    expect(freezes).toEqual([{ kind: "freeze", id: "freeze", name: STREAK_FREEZE.name, price: 120, consumable: true }]);
    expect(catalogueItem("freeze", "freeze")?.price).toBe(STREAK_FREEZE.price);
  });

  it("is written for Rust as it is here", () => {
    expect(rustItem("freeze", "freeze")).toEqual({ kind: "freeze", id: "freeze", price: 120, consumable: true });
  });

  it("is in no set and no wish, here or in Rust's copy", () => {
    expect(SETS.some((set) => (set.kind as string) === "freeze" || set.items.includes("freeze"))).toBe(false);
    expect(wished.some((key) => key.endsWith(":freeze"))).toBe(false);
    expect(rust.sets.some((set) => set.kind === "freeze" || set.items.includes("freeze"))).toBe(false);
    expect(JSON.stringify(rust.wish)).not.toContain("freeze");
  });

  it("is never owned and never counted: a new reader has none, and no collection has a place for it", async () => {
    const overview = await pipService.overview();
    expect(overview.owned.some((thing) => (thing.kind as string) === "freeze")).toBe(false);
    expect(overview.collection.freeze).toBeUndefined();
    expect(overview.sets.some((set) => (set.kind as string) === "freeze")).toBe(false);
  });
});

describe("the radio's sounds in the catalogue", () => {
  it("are three, each bought once, each a common thing: about a week of reading", () => {
    const sounds = items.filter((item) => item.kind === "sound");
    expect(sounds.map((sound) => sound.id)).toEqual(SOUNDS.map((sound) => sound.id));
    expect(sounds.length).toBe(3);
    for (const sound of sounds) {
      expect(sound.consumable).toBeUndefined();
      expect(sound.level).toBeUndefined();
      expect(sound.price).toBeGreaterThanOrEqual(PACING.perWeek * 0.6);
      expect(sound.price).toBeLessThanOrEqual(PACING.perWeek * 1.2);
      expect(rustItem("sound", sound.id)).toEqual({ kind: "sound", id: sound.id, price: sound.price });
    }
  });

  it("are in no set and no wish", () => {
    expect(SETS.some((set) => (set.kind as string) === "sound")).toBe(false);
    expect(wished.some((key) => key.startsWith("sound:"))).toBe(false);
  });

  it("are counted as a kind of their own, apart from every other: none are a new reader's", async () => {
    // Decided on purpose: a sound is kept, so the by-kind count has it (as
    // Rust's does), and no other kind's total moves for it.
    const overview = await pipService.overview();
    expect(overview.collection.sound).toEqual({ owned: 0, total: SOUNDS.length });
    expect(overview.owned.some((thing) => thing.kind === "sound")).toBe(false);
    expect(overview.collection.accessory?.total).toBe(ACCESSORIES.length);
    expect(overview.collection.move?.total).toBe(items.filter((item) => item.kind === "move").length);
  });
});

describe("rare things that open at a level", () => {
  const rare = RARE_LEVELS.map((entry) => ({ ...entry, item: catalogueItem(entry.kind, entry.id) }));

  it("are six to eight things in the catalogue, each for sale at a real price, at least four of them worn", () => {
    expect(rare.length).toBeGreaterThanOrEqual(6);
    expect(rare.length).toBeLessThanOrEqual(8);
    expect(new Set(rare.map((entry) => `${entry.kind}:${entry.id}`)).size).toBe(rare.length);
    for (const entry of rare) {
      expect(entry.item, `${entry.kind} ${entry.id}`).not.toBeNull();
      expect(entry.item?.price).toBeGreaterThan(0);
      expect(entry.item?.level).toBe(entry.level);
      expect(levelFor(entry.kind, entry.id)).toBe(entry.level);
    }
    expect(rare.filter((entry) => entry.kind === "accessory").length).toBeGreaterThanOrEqual(4);
  });

  it("are spread over the levels: a couple early, a few in the middle, one or two far off", () => {
    const levels = rare.map((entry) => entry.level);
    for (const level of levels) {
      expect(Number.isInteger(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(2);
      expect(level).toBeLessThanOrEqual(20);
    }
    const within = (low: number, high: number) => levels.filter((level) => level >= low && level <= high).length;
    expect(within(3, 5)).toBeGreaterThanOrEqual(2);
    expect(within(8, 12)).toBeGreaterThanOrEqual(2);
    expect(within(15, 20)).toBeGreaterThanOrEqual(1);
    expect(new Set(levels).size).toBe(levels.length);
  });

  it("cost more the later they open, and more than anything in the wardrobe that is not rare", () => {
    const byLevel = [...rare].sort((a, b) => a.level - b.level).map((entry) => entry.item?.price ?? 0);
    expect(byLevel).toEqual([...byLevel].sort((a, b) => a - b));
    const dearestCommon = Math.max(...ACCESSORIES.filter((item) => levelFor("accessory", item.id) === null).map((item) => accessoryPrice(item)));
    expect(Math.min(...byLevel)).toBeGreaterThan(dearestCommon);
    // Rare by the file's pacing: within three or four weeks of reading, not months.
    expect(Math.max(...byLevel)).toBeLessThanOrEqual(PACING.perWeek * 4);
  });

  it("are the only things with a level, and reach Rust with it", () => {
    const gated = items.filter((item) => item.level !== undefined).map((item) => `${item.kind}:${item.id}`);
    expect(gated.sort()).toEqual(rare.map((entry) => `${entry.kind}:${entry.id}`).sort());
    for (const entry of rare) expect(rustItem(entry.kind, entry.id)?.level).toBe(entry.level);
    expect(rust.items.filter((item) => item.level !== undefined).length).toBe(rare.length);
  });

  it("are never wished for, and in no set: a set never changes once it has shipped", () => {
    for (const entry of rare) {
      expect(wished).not.toContain(`${entry.kind}:${entry.id}`);
      expect(inSets).not.toContain(`${entry.kind}:${entry.id}`);
    }
  });

  it("begin where Rust says a level begins", () => {
    expect([2, 3, 5, 10, 15, 20].map(levelStart)).toEqual([100, 300, 1000, 4500, 10500, 19000]);
    expect(levelStart(1)).toBe(0);
  });
});

describe("what was for sale before", () => {
  it("costs what it did: nothing added moved a price", () => {
    const price = (kind: Parameters<typeof catalogueItem>[0], id: string) => catalogueItem(kind, id)?.price;
    expect(price("accessory", "cap")).toBe(30);
    expect(price("accessory", "crown")).toBe(200);
    expect(price("accessory", "jetpack")).toBe(200);
    expect(price("skin", "gardener")).toBe(80);
    expect(price("skin", "king")).toBe(2400);
    expect(price("move", "blastoff")).toBe(360);
  });
});
