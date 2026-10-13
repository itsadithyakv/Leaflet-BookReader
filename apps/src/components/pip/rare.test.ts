import { describe, expect, it } from "vitest";
import { RARE_GROUP, levelHint, levelLabel, levelLock, rareLast, readerLevel } from "./rare";

describe("the reader's level, as the shop reads it", () => {
  it("is the overview's", () => {
    expect(readerLevel({ level: { level: 7 } })).toBe(7);
  });

  it("is 1 where the overview has none: an older Rust side, the browser preview, before it loads", () => {
    expect(readerLevel(null)).toBe(1);
    expect(readerLevel(undefined)).toBe(1);
    expect(readerLevel({})).toBe(1);
    expect(readerLevel({ level: null })).toBe(1);
  });

  it("is never less than 1, whatever arrives", () => {
    expect(readerLevel({ level: { level: 0 } })).toBe(1);
    expect(readerLevel({ level: { level: -3 } })).toBe(1);
    expect(readerLevel({ level: { level: Number.NaN } })).toBe(1);
    expect(readerLevel({ level: { level: 4.9 } })).toBe(4);
  });
});

describe("a rare thing's lock", () => {
  it("says the level and nothing else, with the rest for a tooltip", () => {
    expect(levelLock(8, 3)).toEqual({ text: "Level 8", hint: "Opens at level 8. Seeds you earn count, spent or not." });
    expect(levelLabel(12)).toBe("Level 12");
    expect(levelHint(12)).toContain("level 12");
  });

  it("goes once the reader is there", () => {
    expect(levelLock(8, 7)).not.toBeNull();
    expect(levelLock(8, 8)).toBeNull();
    expect(levelLock(8, 30)).toBeNull();
  });

  it("is not there at all for a thing with no level", () => {
    expect(levelLock(null, 1)).toBeNull();
    expect(levelLock(undefined, 1)).toBeNull();
  });
});

describe("the order of a tab with rare things in it", () => {
  type Thing = { id: string; price: number; level?: number | null };
  const byPrice = (a: Thing, b: Thing) => a.price - b.price;
  const things: Thing[] = [
    { id: "wizardhat", price: 420, level: 12 },
    { id: "crown", price: 200 },
    { id: "magnifier", price: 240, level: 3 },
    { id: "cap", price: 30, level: null },
    { id: "quill", price: 260, level: 5 }
  ];

  it("keeps everything else first, in its own order, then the rare ones by level", () => {
    expect([...things].sort(rareLast(byPrice)).map((thing) => thing.id)).toEqual(["cap", "crown", "magnifier", "quill", "wizardhat"]);
  });

  it("orders by level even where the prices disagree, and by the rest between two of one level", () => {
    const odd: Thing[] = [
      { id: "dear", price: 900, level: 2 },
      { id: "cheap", price: 10, level: 9 },
      { id: "twin", price: 5, level: 9 }
    ];
    expect([...odd].sort(rareLast(byPrice)).map((thing) => thing.id)).toEqual(["dear", "twin", "cheap"]);
  });

  it("has one heading for them", () => {
    expect(RARE_GROUP).toBe("Rare");
  });
});
