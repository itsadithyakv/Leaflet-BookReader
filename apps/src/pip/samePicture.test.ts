import { describe, expect, it, vi } from "vitest";
import { picturePool, pixelKey, shownOnce } from "./samePicture";

const picture = (fill: number, width = 4, height = 4) => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(fill) });

describe("pictures with the same pixels, as one picture", () => {
  it("gives back the first picture for any later one with the same pixels", () => {
    const pool = picturePool<ReturnType<typeof picture>>();
    const first = picture(7);
    expect(pool.same(first)).toBe(first);
    expect(pool.same(picture(7))).toBe(first);
    const other = picture(8);
    expect(pool.same(other)).toBe(other);
    // Same bytes, another shape: another picture.
    const wide = picture(7, 8, 2);
    expect(pool.same(wide)).toBe(wide);
  });

  it("tells apart pictures that differ by one pixel", () => {
    const a = picture(0);
    const b = picture(0);
    b.data[37] = 1;
    expect(pixelKey(a)).not.toBe(pixelKey(b));
    const pool = picturePool<ReturnType<typeof picture>>();
    expect(pool.same(a)).toBe(a);
    expect(pool.same(b)).toBe(b);
  });

  it("starts again past its cap, which costs only a frame drawn twice", () => {
    const pool = picturePool<ReturnType<typeof picture>>(2);
    const a = picture(1);
    pool.same(a);
    pool.same(picture(2));
    pool.same(picture(3));
    expect(pool.size).toBe(1);
    const again = picture(1);
    expect(pool.same(again)).toBe(again);
  });
});

describe("a canvas that puts up a picture only when it is not the one up already", () => {
  it("draws a held pose once, and again after it was cleared", () => {
    const shown = shownOnce<object>();
    const draw = vi.fn();
    const held = {};
    const other = {};
    // A move like `held`: two pictures in twelve frames.
    const frames = [held, held, held, other, other, held, held, held, held, held, other, held];
    const drawn = frames.filter((frame) => shown.put(frame, draw)).length;
    expect(drawn).toBe(5);
    expect(draw).toHaveBeenCalledTimes(5);
    shown.forget();
    expect(shown.put(held, draw)).toBe(true);
  });
});
