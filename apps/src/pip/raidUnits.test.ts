import { describe, expect, it } from "vitest";
import { Painter } from "./painter.js";
import { RAID_SPRITES } from "./raid-art.js";

/**
 * The reader's scouts as a raid draws them (raid-art.js `raidunit`, 2026-10-25): four kinds, each its own shape and
 * colour, outlined dark all round so it stands off the grass, a shadow under it, and a body that stays put while the
 * feet (and what is in the hand) move, so a crowd never shimmers.
 */

type Sprite = { w: number; h: number; frames: number; draw: (g: Painter, f: number, o: { variant: number }) => void };
const unit = (RAID_SPRITES as unknown as Record<string, Sprite>).raidunit;
const INK = "#141012";
const draw = (kind: number, frame: number) => {
  const g = new Painter(unit.w, unit.h, frame);
  unit.draw(g, frame, { variant: kind });
  const pixels = (g as unknown as { C: { d: Array<string | null> } }).C.d;
  return (x: number, y: number) => pixels[y * unit.w + x];
};
const KINDS = [0, 1, 2, 3];

describe("the raid's scouts", () => {
  it("are four different pictures, one a kind", () => {
    const pictures = KINDS.map((kind) => {
      const at = draw(kind, 0);
      const rows: string[] = [];
      for (let y = 0; y < unit.h; y++) for (let x = 0; x < unit.w; x++) rows.push(at(x, y) ?? ".");
      return rows.join(",");
    });
    expect(new Set(pictures).size).toBe(4);
  });

  it("are each outlined dark, with a shadow on the ground under them", () => {
    for (const kind of KINDS) {
      const at = draw(kind, 0);
      let ink = 0;
      let shadow = 0;
      for (let y = 0; y < unit.h; y++) {
        for (let x = 0; x < unit.w; x++) {
          const colour = at(x, y);
          if (colour === INK) ink += 1;
          // Translucent black: the shadow (alone, or under the outline's own foot).
          if (colour && colour.length === 9 && colour.startsWith("#000000")) shadow += 1;
        }
      }
      expect(ink, `kind ${kind}'s outline`).toBeGreaterThan(20);
      expect(shadow, `kind ${kind}'s shadow`).toBeGreaterThan(3);
      // Every pixel at the picture's edge that is drawn is ink or shadow: nothing of the body touches the grass.
      for (let y = 0; y < unit.h; y++) {
        for (let x = 0; x < unit.w; x++) {
          const colour = at(x, y);
          if (!colour || colour === INK || colour.length === 9) continue;
          const open = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((next) => next === null || next === undefined || next.length === 9);
          // (The Puffcap's spark on its fuse, and the slinger's stone flying, are the only bright pixels in the open.)
          if (open) expect(kind === 3 || kind === 1, `kind ${kind}: an open pixel at ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it("keep the body still from frame to frame: only the feet and what is held move", () => {
    // The body's rows, over the feet (row 13) and under what is held up (the sling's stone, the fuse's spark).
    const body = (kind: number, frame: number) => {
      const at = draw(kind, frame);
      const rows: string[] = [];
      for (let y = 6; y <= 11; y++) for (let x = 2; x <= 10; x++) rows.push(at(x, y) ?? ".");
      return rows.join(",");
    };
    for (const kind of KINDS) {
      const first = body(kind, 0);
      for (let frame = 1; frame < unit.frames; frame++) expect(body(kind, frame), `kind ${kind}, frame ${frame}`).toBe(first);
    }
  });
});
