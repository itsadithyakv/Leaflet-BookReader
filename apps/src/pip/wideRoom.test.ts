import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as pip from "./index";
import { houseLevels, levelFixtures, registerHouseArt, renderHouseLevel, type HouseLevel, type LevelDecor } from "./home.js";

registerHouseArt(pip as unknown as Record<string, unknown>);
const { PATTERN_SPAN, WALLPAPERS, FLOORS } = pip;

// (No canvas here: a picture is its numbers and its size, which is all that is asked of one.)
class Picture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
    if (typeof a === "number") {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    } else {
      this.data = a;
      this.width = b;
      this.height = c ?? a.length / 4 / b;
    }
  }
}
const had = (globalThis as { ImageData?: unknown }).ImageData;
beforeAll(() => {
  (globalThis as { ImageData?: unknown }).ImageData = had ?? Picture;
});
afterAll(() => {
  if (!had) delete (globalThis as { ImageData?: unknown }).ImageData;
});

const PAD = { left: 37, right: 61, top: 23, bottom: 9 };

/** The room's own part of a picture drawn wide, as the numbers of a picture of the room alone. */
const crop = (wide: ImageData, level: HouseLevel) => {
  const out = new Uint8ClampedArray(level.w * level.h * 4);
  for (let y = 0; y < level.h; y++) {
    const from = ((y + PAD.top) * wide.width + PAD.left) * 4;
    out.set(wide.data.subarray(from, from + level.w * 4), y * level.w * 4);
  }
  return out;
};

const decorOf = (level: HouseLevel, wallpaper: string | null = null, floor: string | null = null): LevelDecor => {
  const placed = level.defaults ?? [];
  return { wallpaper, floor, placed, fixtures: levelFixtures(level, { placed }) } as LevelDecor;
};

describe("a floor drawn wide (the house filling a phone on its side)", { timeout: 60_000 }, () => {
  it("draws every floor's own room exactly as alone, by day, by night and with its glass left clear, so nothing in it moves", () => {
    for (const level of houseLevels()) {
      if (level.fallback) continue;
      const decor = decorOf(level);
      for (const [night, hour] of [[false, 11], [true, 22], [false, 6.5]] as const) {
        for (const openSky of level.garden ? [true, false] : [false]) {
          const alone = renderHouseLevel(level, 5, decor, night, hour, openSky) as ImageData;
          const wide = renderHouseLevel(level, 5, decor, night, hour, openSky, PAD) as ImageData;
          expect([wide.width, wide.height]).toEqual([level.w + PAD.left + PAD.right, level.h + PAD.top + PAD.bottom]);
          expect(crop(wide, level), `${level.id} ${hour}h`).toEqual(alone.data);
        }
      }
    }
  });

  it("draws the room the same under every wallpaper and floor, and fills the wide picture to its corners", () => {
    const bedroom = houseLevels().find((entry) => entry.id === "bedroom") as HouseLevel;
    const floors = (FLOORS as Array<{ id: string }>).map((entry) => entry.id);
    (WALLPAPERS as Array<{ id: string }>).forEach((paper, index) => {
      const decor = decorOf(bedroom, paper.id, floors[index % floors.length]);
      const alone = renderHouseLevel(bedroom, 3, decor, false, 12) as ImageData;
      const wide = renderHouseLevel(bedroom, 3, decor, false, 12, false, PAD) as ImageData;
      expect(crop(wide, bedroom), paper.id).toEqual(alone.data);
      // Nothing left see-through in the wide picture: every corner and edge is drawn.
      let clear = 0;
      for (let i = 3; i < wide.data.length; i += 4) if (wide.data[i] !== 255) clear++;
      expect(clear, paper.id).toBe(0);
    });
  });

  it("carries each pattern on to the left of the room in phase, with no seam", () => {
    // Every repeat the wallpapers and floors are drawn in (house.js) fits the span whole.
    for (const period of [10, 12, 8, 16, 9, 28, 1080, 20, 40, 37 * 29, 14, 30, 6]) expect(PATTERN_SPAN % period, String(period)).toBe(0);
    // A pattern with a short repeat: the column left of the room is the one a repeat in from its edge.
    const bedroom = houseLevels().find((entry) => entry.id === "bedroom") as HouseLevel;
    for (const [paper, floor, period] of [["stripes", "tiles", 48], ["cream", "checker", 80], ["hearts", "tiles", 80]] as const) {
      const wide = renderHouseLevel(bedroom, 0, { wallpaper: paper, floor, placed: [], fixtures: [] } as LevelDecor, false, 12, false, PAD) as ImageData;
      const at = (x: number, y: number) => Array.from(wide.data.subarray(((y + PAD.top) * wide.width + x + PAD.left) * 4, ((y + PAD.top) * wide.width + x + PAD.left) * 4 + 4)).join();
      for (const y of [20, 50, 100, 115]) for (let k = 1; k <= 8; k++) expect(at(-k, y), `${paper} ${y}`).toBe(at(period - k, y));
    }
  });
});
