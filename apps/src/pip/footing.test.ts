import { describe, expect, it } from "vitest";
import { FOOTING_PAD, besideSurface, clearSpans, footprint, nearestClear, standsOnWords, strollTarget } from "./footing";
import { HALF_W } from "./wall";

describe("Pip's footing on a phone", () => {
  // A floor from 26 to 386 (a 412 px phone), two columns of words.
  const words = [
    [16, 125],
    [210, 319],
    [375, 390]
  ] as const;

  it("leaves the floor whole when there are no words", () => {
    expect(clearSpans([], 26, 386)).toEqual([[26, 386]]);
  });

  it("takes each word, widened by her body and a little room, out of the floor", () => {
    const pad = 4;
    expect(clearSpans(words, 26, 386, pad)).toEqual([
      [125 + HALF_W + pad, 210 - HALF_W - pad],
      [319 + HALF_W + pad, 375 - HALF_W - pad]
    ]);
  });

  it("has nowhere to stand when the words leave no gap her size", () => {
    expect(clearSpans([[0, 200], [220, 400]], 26, 386)).toEqual([]);
    expect(nearestClear(100, [])).toBeNull();
  });

  it("only counts what she really covers as underfoot", () => {
    expect(standsOnWords(266, words)).toBe(true);
    expect(standsOnWords(340, words)).toBe(false);
    // A word ending just at her edge is not under her.
    expect(standsOnWords(319 + HALF_W, words)).toBe(false);
  });

  it("steps to the nearest clear spot, which is clear by more than the test that moved her", () => {
    const spans = clearSpans(words, 26, 386);
    const to = nearestClear(266, spans);
    expect(to).toBe(341);
    expect(standsOnWords(to as number, words)).toBe(false);
    // Arriving within 2 px of it (the walk's stop) is still clear: she does not set off again.
    expect(standsOnWords((to as number) - 2, words)).toBe(false);
  });

  it("strolls only to clear spots, and not to where she already is", () => {
    const spans = clearSpans(words, 26, 386);
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const to = strollTarget(160, spans, 50, () => r);
      expect(to).not.toBeNull();
      expect(standsOnWords(to as number, words)).toBe(false);
      expect(Math.abs((to as number) - 160)).toBeGreaterThanOrEqual(50);
    }
    expect(strollTarget(160, [[150, 170]], 50)).toBeNull();
  });

  it("gives her bed its own width and height: wider than she stands, as tall as the sprite", () => {
    expect(footprint("idle", 64, 50)).toEqual({ halfW: HALF_W, tall: 50 });
    expect(footprint("sleep", 64, 50)).toEqual({ halfW: HALF_W, tall: 50 });
    for (const bed of ["bedtime", "bedsleep"]) {
      const { halfW, tall } = footprint(bed, 64, 50);
      expect(halfW).toBe(30);
      expect(halfW).toBeGreaterThan(HALF_W);
      expect(tall).toBe(64);
    }
    // At another pixel size the bed scales with the sprite.
    expect(footprint("bedsleep", 48, 50)).toEqual({ halfW: 23, tall: 50 });
  });

  it("moves the bed off a card's ⋯ and its percentage that her body alone would only graze", () => {
    // 25-lib-after-free.png: the bed's middle at 373, a ⋯ at 368-400 above and "0%" at 374-390.
    const under = [[368, 400], [374, 390]] as const;
    const bed = footprint("bedsleep", 64, 50);
    expect(standsOnWords(373, under, bed.halfW)).toBe(true);
    const room = bed.halfW - HALF_W;
    const to = nearestClear(373, clearSpans(under, 26 + room, 386 - room, FOOTING_PAD, bed.halfW));
    expect(to).not.toBeNull();
    expect(standsOnWords(to as number, under, bed.halfW)).toBe(false);
    // And the whole bed is still on her floor.
    expect((to as number) - bed.halfW).toBeGreaterThanOrEqual(26 - HALF_W);
  });
});

describe("Pip on the book being read, on a phone on its side", () => {
  it("counts the lane beside a floating book as no footing, so she rests on the book, not over the page", () => {
    // 914 px of page past the rail (110), the book being read floating from 230 to 720.
    const beside = besideSurface(110, 914, [230, 720]);
    expect(beside).toEqual([
      [110, 230],
      [720, 914]
    ]);
    const spans = clearSpans(beside, 110, 914);
    // Over the highlights card and the heading at x 160 she walks onto the book.
    const to = nearestClear(160, spans);
    expect(to).not.toBeNull();
    expect(to as number).toBeGreaterThanOrEqual(230 + HALF_W);
    expect(standsOnWords(160, beside)).toBe(true);
  });

  it("changes nothing where the floor is the whole lane (upright, the tab bar, the page's foot)", () => {
    expect(besideSurface(0, 412, null)).toEqual([]);
    expect(besideSurface(0, 412, [0, 412])).toEqual([]);
  });
});
