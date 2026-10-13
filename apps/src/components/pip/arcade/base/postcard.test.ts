import { describe, expect, it } from "vitest";
import { GAME_H, GAME_W } from "../games";
import {
  POSTCARD_GROUND,
  POSTCARD_MOMENT,
  POSTCARD_PICTURE_H,
  POSTCARD_PX,
  POSTCARD_SKY,
  POSTCARD_W,
  postcardFigures,
  postcardFileName,
  postcardLately,
  postcardLines,
  postcardSize,
  postcardTitle,
  postcardWords,
  type PostcardStats
} from "./postcard";

const stats = (over: Partial<PostcardStats> = {}): PostcardStats => ({ name: "Mira", level: 4, books: 23, minutes: 310 * 60 + 59, streak: 12, lately: ["Piranesi", "The Dispossessed"], ...over });

describe("whose the Hollow is", () => {
  it("is the reader's, by name", () => {
    expect(postcardTitle("Mira")).toBe("Mira's Hollow");
    expect(postcardTitle("  Mira   Okafor ")).toBe("Mira Okafor's Hollow");
  });

  it("is a reader's where there is no name", () => {
    expect(postcardTitle(null)).toBe("A reader's Hollow");
    expect(postcardTitle("")).toBe("A reader's Hollow");
    expect(postcardTitle("   ")).toBe("A reader's Hollow");
  });

  it("keeps the Hollow on the paper when the name is very long", () => {
    const title = postcardTitle("A".repeat(80));
    expect(title.endsWith("…'s Hollow")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(24 + "'s Hollow".length);
  });
});

describe("the figures", () => {
  it("are the level, the books, the hours and the streak", () => {
    expect(postcardFigures(stats())).toBe("Level 4 · 23 books · 310 hours · 12-day streak");
  });

  it("say one of a thing as one", () => {
    expect(postcardFigures(stats({ level: 1, books: 1, minutes: 60, streak: 1 }))).toBe("Level 1 · 1 book · 1 hour · 1-day streak");
  });

  it("round the hours down", () => {
    expect(postcardFigures(stats({ minutes: 119 }))).toContain("· 1 hour ·");
    expect(postcardFigures(stats({ minutes: 120 }))).toContain("· 2 hours ·");
  });

  it("leave the streak out when there is none", () => {
    expect(postcardFigures(stats({ streak: 0 }))).toBe("Level 4 · 23 books · 310 hours");
  });

  it("say minutes for a camp with under an hour read", () => {
    expect(postcardFigures(stats({ books: 0, minutes: 45, streak: 0 }))).toBe("Level 4 · 0 books · 45 minutes");
    expect(postcardFigures(stats({ minutes: 1, streak: 0 }))).toContain("1 minute");
  });

  it("group the thousands, the same on every machine", () => {
    expect(postcardFigures(stats({ books: 1204, minutes: 2500 * 60, streak: 1001 }))).toBe("Level 4 · 1,204 books · 2,500 hours · 1,001-day streak");
  });

  it("make what they can of figures that are not whole, or not figures", () => {
    expect(postcardFigures(stats({ level: 0, books: -3, minutes: Number.NaN, streak: 2.9 }))).toBe("Level 1 · 0 books · 0 minutes · 2-day streak");
  });
});

describe("the books lately finished", () => {
  it("are named, newest first", () => {
    expect(postcardLately(["Piranesi", "The Dispossessed"])).toBe("Lately: Piranesi, The Dispossessed");
  });

  it("are not said when there are none", () => {
    expect(postcardLately([])).toBeNull();
    expect(postcardLately(["", "   "])).toBeNull();
  });

  it("are three at most, tidied, and none of them too long", () => {
    expect(postcardLately(["One", " Two\n", "", "Three", "Four"])).toBe("Lately: One, Two, Three");
    const long = postcardLately(["B".repeat(90), "Short"]) ?? "";
    expect(long.endsWith("…, Short")).toBe(true);
    expect(long.length).toBeLessThan(60);
  });
});

describe("the card in words", () => {
  it("is one sentence of the same figures", () => {
    expect(postcardWords(stats())).toBe("Mira's Hollow in Leaflet, level 4: 23 books finished, 310 hours read, a 12-day streak; lately Piranesi, The Dispossessed.");
  });

  it("says no more than there is to say", () => {
    expect(postcardWords(stats({ name: null, level: 1, books: 1, minutes: 60, streak: 0, lately: [] }))).toBe("A reader's Hollow in Leaflet, level 1: 1 book finished, 1 hour read.");
  });
});

describe("the file it is saved as", () => {
  it("is named for the day, by the reader's own clock", () => {
    expect(postcardFileName(new Date(2026, 9, 13, 23, 59))).toBe("leaflet-hollow-2026-10-13.png");
    expect(postcardFileName(new Date(2027, 0, 5))).toBe("leaflet-hollow-2027-01-05.png");
  });
});

describe("the card's size", () => {
  it("is the camp at a whole number of pixels to its own, with sky over it and grass under", () => {
    expect(Number.isInteger(POSTCARD_PX)).toBe(true);
    expect(POSTCARD_W).toBe(GAME_W * POSTCARD_PX);
    expect(POSTCARD_W).toBe(1200);
    expect(POSTCARD_PICTURE_H).toBe((POSTCARD_SKY + GAME_H + POSTCARD_GROUND) * POSTCARD_PX);
  });

  it("is a line taller when books are named, and no wider", () => {
    const plain = postcardSize(stats({ lately: [] }));
    const named = postcardSize(stats());
    expect(plain.width).toBe(POSTCARD_W);
    expect(named.width).toBe(POSTCARD_W);
    expect(plain.height).toBeGreaterThan(POSTCARD_PICTURE_H);
    expect(named.height).toBeGreaterThan(plain.height);
  });

  it("has every line on the paper, one under another", () => {
    for (const given of [stats(), stats({ lately: [] })]) {
      const lines = postcardLines(given);
      const { height } = postcardSize(given);
      expect(lines.map((line) => line.text)).toEqual([postcardTitle(given.name), postcardFigures(given), ...(given.lately.length > 0 ? [postcardLately(given.lately)] : [])]);
      lines.forEach((line, at) => {
        expect(line.baseline - line.size).toBeGreaterThan(at === 0 ? POSTCARD_PICTURE_H : lines[at - 1].baseline);
        expect(line.baseline).toBeLessThan(height);
      });
    }
  });
});

describe("the moment the camp is painted at", () => {
  it("is a still by day, at the card's own scale, with Pip in it and nothing chosen", () => {
    expect(POSTCARD_MOMENT.dusk).toBe(0);
    expect(POSTCARD_MOMENT.px).toBe(POSTCARD_PX);
    expect(POSTCARD_MOMENT.sky).toBe(POSTCARD_SKY);
    expect(POSTCARD_MOMENT.pip).toBe(true);
    expect(typeof POSTCARD_MOMENT.time).toBe("number");
    expect(typeof POSTCARD_MOMENT.clock).toBe("number");
    expect(POSTCARD_MOMENT.selected ?? null).toBeNull();
  });
});
