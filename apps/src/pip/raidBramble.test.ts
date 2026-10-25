import { describe, expect, it } from "vitest";
import { Painter } from "./painter.js";
import { RAID_SPRITES } from "./raid-art.js";

/**
 * The thorn hedge's bramble (raid-art.js `raidzone` 0 and 4, 2026-10-26): the old clump was dark stems and dark leaves,
 * and a hedge of them read as one dark block. A bramble is canes in a blackberry's pinks, arched with grass under
 * them, pale thorns standing out of them, and fruit: mostly colour and open ground, not ink.
 */

type Sprite = { w: number; h: number; draw: (g: Painter, f: number, o: { variant: number }) => void };
const zone = (RAID_SPRITES as unknown as Record<string, Sprite>).raidzone;
const draw = (variant: number) => {
  const g = new Painter(zone.w, zone.h, 0);
  zone.draw(g, 0, { variant });
  return (g as unknown as { C: { d: Array<string | null> } }).C.d;
};
const CANES = ["#D46F84", "#9C3E56", "#6A2436"];
const THORN = "#FFF1CF";
const INK = "#2A1A10";
/** How dark a colour is, 0 to 255 (its brightest channel). */
const value = (colour: string) => Math.max(parseInt(colour.slice(1, 3), 16), parseInt(colour.slice(3, 5), 16), parseInt(colour.slice(5, 7), 16));

describe("the thorn hedge's brambles", () => {
  for (const variant of [0, 4]) {
    it(`shape ${variant} reads as bramble: pink canes, pale thorns standing out, fruit, and grass under the arches`, () => {
      const pixels = draw(variant);
      const drawn = pixels.filter((colour): colour is string => colour !== null);
      const count = (test: (colour: string) => boolean) => drawn.filter(test).length;
      expect(count((colour) => CANES.includes(colour)), "cane").toBeGreaterThan(25);
      expect(count((colour) => colour === THORN), "thorns").toBeGreaterThanOrEqual(6);
      expect(count((colour) => colour === "#3A1E4A"), "a blackberry").toBeGreaterThan(0);
      expect(count((colour) => colour === "#E0393E"), "a red one").toBeGreaterThan(0);
      // Not a dark block: the old clump was three parts in four ink or near-black, and hardly a pixel in fourteen light.
      // A bramble's ink is its outline, and near half of it is bright: the canes' backs, the thorns, the fruit.
      expect(count((colour) => colour === INK || value(colour) < 0x50) / drawn.length).toBeLessThan(0.6);
      expect(count((colour) => value(colour) >= 0x90) / drawn.length).toBeGreaterThan(0.35);
      // Grass under the arches: on the ground row, inside the bramble's own width, at least two gaps between its canes.
      const ground = pixels.slice((zone.h - 1) * zone.w, zone.h * zone.w).map((colour) => (colour === null ? "." : "#")).join("");
      const inner = ground.slice(ground.indexOf("#"), ground.lastIndexOf("#") + 1);
      expect(inner.split("#").filter((run) => run.length > 0).length, ground).toBeGreaterThanOrEqual(2);
      // Every thorn stands in the open, off a cane's ink line: it is a point, not a speck in the middle of the bush.
      pixels.forEach((colour, index) => {
        if (colour !== THORN) return;
        const x = index % zone.w;
        const y = Math.floor(index / zone.w);
        expect(pixels[(y + 1) * zone.w + x], `under the thorn at ${x},${y}`).not.toBeNull();
      });
    });
  }

  it("comes in two shapes, so a hedge is not one clump over and over", () => {
    expect(draw(0).join(",")).not.toEqual(draw(4).join(","));
    // The pit, the sprung pit and the reeds are as they were: each its own picture.
    expect(new Set([0, 1, 2, 3, 4].map((variant) => draw(variant).join(","))).size).toBe(5);
  });
});
