import { describe, expect, it } from "vitest";
import {
  clearWhiteGround,
  drawnRect,
  looksLikePhoto,
  pageToneFor,
  tonePixels,
  type PageTone,
  type PixelRect
} from "./pageTone";

const pixels = (...colours: Array<[number, number, number]>) =>
  new Uint8ClampedArray(colours.flatMap(([r, g, b]) => [r, g, b, 255]));

const trueBlack: PageTone = { dark: true, paper: [0, 0, 0], ink: [242, 241, 235] };
const warmPaper: PageTone = { dark: false, paper: [240, 234, 220], ink: [48, 41, 31] };

/** A square picture, each pixel coloured by where it is. */
const picture = (side: number, colour: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const [r, g, b] = colour(x, y);
      data.set([r, g, b, 255], (y * side + x) * 4);
    }
  }
  const rect: PixelRect = { x: 0, y: 0, width: side, height: side };
  return { data, rect, side };
};

describe("the finish on a PDF page", () => {
  it("shows the page as drawn on True white, and tones every other finish", () => {
    expect(pageToneFor("true-white", "dark")).toBeNull();
    expect(pageToneFor("true-black", "light")).toEqual({ dark: true, paper: [0, 0, 0], ink: [242, 241, 235] });
    expect(pageToneFor("paper", "dark")?.dark).toBe(false);
    // "Match app theme" follows the app.
    expect(pageToneFor("app", "dark")?.dark).toBe(true);
    expect(pageToneFor("app", "light")?.dark).toBe(false);
  });

  it("turns a dark page's paper to the page colour and its ink to the text colour", () => {
    const data = pixels([255, 255, 255], [0, 0, 0]);
    tonePixels(data, trueBlack);
    expect(Array.from(data)).toEqual([0, 0, 0, 255, 242, 241, 235, 255]);
  });

  it("keeps a colour's hue when it turns its lightness over", () => {
    // A dark blue link becomes a light blue one, not yellow (a plain negative).
    const data = pixels([0, 0, 238], [200, 0, 0]);
    tonePixels(data, { dark: true, paper: [0, 0, 0], ink: [255, 255, 255] });
    const [r, g, b, , r2, g2, b2] = Array.from(data);
    expect(b).toBe(255);
    expect(r).toBe(g);
    expect(r).toBeLessThan(40);
    expect(r2).toBe(255);
    expect(g2).toBe(b2);
    expect(g2).toBeLessThan(80);
  });

  it("only tints a light page", () => {
    const data = pixels([255, 255, 255], [0, 0, 0], [128, 128, 128]);
    tonePixels(data, warmPaper);
    expect(Array.from(data.slice(0, 3))).toEqual([240, 234, 220]);
    expect(Array.from(data.slice(4, 7))).toEqual([48, 41, 31]);
    // Greys stay between the two, in order.
    expect(data[8]).toBeGreaterThan(48);
    expect(data[8]).toBeLessThan(240);
  });

  it("leaves transparency alone", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 17]);
    tonePixels(data, trueBlack);
    expect(data[3]).toBe(17);
  });
});

describe("telling a photograph from the page", () => {
  it("takes smooth tones for a photograph", () => {
    const { data, rect, side } = picture(96, (x, y) => {
      const v = Math.round(((x + y) / 190) * 255);
      return [v, Math.round(v * 0.9), Math.round(v * 0.7)];
    });
    expect(looksLikePhoto(data, side, rect)).toBe(true);
  });

  it("takes a black and white photograph for one too", () => {
    const { data, rect, side } = picture(96, (x) => {
      const v = Math.round((x / 95) * 255);
      return [v, v, v];
    });
    expect(looksLikePhoto(data, side, rect)).toBe(true);
  });

  it("turns a scan of text with the page, yellowed paper and soft letters included", () => {
    const { data, rect, side } = picture(96, (x, y) => {
      // Lines of "text": a dark stroke with a soft edge every few pixels.
      const inLine = y % 12 < 5;
      const stroke = x % 7;
      if (inLine && stroke === 0) return [52, 44, 30];
      if (inLine && stroke === 1) return [150, 138, 110];
      return [232, 220, 192];
    });
    expect(looksLikePhoto(data, side, rect)).toBe(false);
  });

  it("turns a flat-colour chart with the page", () => {
    const { data, rect, side } = picture(96, (x, y) => {
      if (y > 70) return [40, 40, 40];
      if (x < 30 && y > 30) return [66, 133, 244];
      if (x > 50 && x < 80 && y > 45) return [219, 68, 55];
      return [255, 255, 255];
    });
    expect(looksLikePhoto(data, side, rect)).toBe(false);
  });

  it("reads only the picture's own pixels on a larger canvas", () => {
    const side = 200;
    const data = new Uint8ClampedArray(side * side * 4).fill(255);
    const rect: PixelRect = { x: 100, y: 100, width: 96, height: 96 };
    for (let y = 0; y < 96; y += 1) {
      for (let x = 0; x < 96; x += 1) {
        const v = Math.round(((x + y) / 190) * 255);
        data.set([v, v, v, 255], ((rect.y + y) * side + rect.x + x) * 4);
      }
    }
    expect(looksLikePhoto(data, side, rect)).toBe(true);
    expect(looksLikePhoto(data, side, { x: 0, y: 0, width: 96, height: 96 })).toBe(false);
  });
});

describe("where a picture was drawn", () => {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  it("follows the canvas transform, flipped or not", () => {
    expect(drawnRect({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 }, 0, 0, 100, 50, 1000, 1000)).toEqual({
      x: 10,
      y: 20,
      width: 200,
      height: 100
    });
    // pdf.js draws images upside down in a flipped space.
    expect(drawnRect({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 300 }, 0, 0, 100, 100, 1000, 1000)).toEqual({
      x: 0,
      y: 200,
      width: 100,
      height: 100
    });
  });

  it("is clipped to the canvas", () => {
    expect(drawnRect(identity, -50, -50, 200, 200, 100, 100)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(drawnRect(identity, 500, 500, 200, 200, 100, 100)).toBeNull();
  });

  it("leaves out bullets, rules and icons", () => {
    expect(drawnRect(identity, 0, 0, 24, 24, 1000, 1000)).toBeNull();
    expect(drawnRect(identity, 0, 0, 600, 3, 1000, 1000)).toBeNull();
  });
});

describe("a picture kept as drawn, on a white ground", () => {
  const SIDE = 64;
  const paper: [number, number, number] = [0, 0, 0];
  const at = (data: Uint8ClampedArray, x: number, y: number) => Array.from(data.slice((y * SIDE + x) * 4, (y * SIDE + x) * 4 + 3));

  /** An illuminated initial: a shaded, coloured disc on white, smoothed at its edge, a white dot inside it. */
  const initial = () =>
    picture(SIDE, (x, y) => {
      const r = Math.hypot(x - 31.5, y - 31.5);
      if (Math.hypot(x - 26, y - 26) < 3.5) {
        return [255, 255, 255];
      }
      if (r >= 25) {
        return [255, 255, 255];
      }
      const disc: [number, number, number] = [200 - x, 40 + y, 60 + x * 2];
      // One pixel of smoothing between the disc and the white round it.
      const edge = Math.min(1, 25 - r);
      return [0, 1, 2].map((c) => Math.round(disc[c] * edge + 255 * (1 - edge))) as [number, number, number];
    });

  it("gives the white round the drawing the colour of the page", () => {
    const { data } = initial();
    expect(clearWhiteGround(data, SIDE, SIDE, paper)).toBe(true);
    expect(at(data, 0, 0)).toEqual([0, 0, 0]);
    expect(at(data, 63, 63)).toEqual([0, 0, 0]);
    expect(at(data, 2, 31)).toEqual([0, 0, 0]);
    expect(at(data, 31, 61)).toEqual([0, 0, 0]);
  });

  it("leaves the drawing as it was drawn", () => {
    const before = initial().data;
    const { data } = initial();
    clearWhiteGround(data, SIDE, SIDE, paper);
    for (let y = 0; y < SIDE; y += 1) {
      for (let x = 0; x < SIDE; x += 1) {
        // Well inside the disc, away from its rim.
        if (Math.hypot(x - 31.5, y - 31.5) < 22) {
          expect(at(data, x, y)).toEqual(at(before, x, y));
        }
      }
    }
  });

  it("leaves white the edge does not reach: a highlight inside the drawing", () => {
    const { data } = initial();
    clearWhiteGround(data, SIDE, SIDE, paper);
    expect(at(data, 26, 26)).toEqual([255, 255, 255]);
  });

  it("leaves no white fringe round the drawing", () => {
    const { data } = initial();
    clearWhiteGround(data, SIDE, SIDE, paper);
    let lightest = 0;
    for (let y = 0; y < SIDE; y += 1) {
      for (let x = 0; x < SIDE; x += 1) {
        const r = Math.hypot(x - 31.5, y - 31.5);
        // The ring where the disc was smoothed into the white.
        if (r > 23.5 && r < 27) {
          lightest = Math.max(lightest, Math.min(...at(data, x, y)));
        }
      }
    }
    // Before, this ring held pixels that were nearly white (lowest channel over 200).
    expect(lightest).toBeLessThan(120);
  });

  it("takes the page's own colour, whatever the finish", () => {
    const { data } = initial();
    clearWhiteGround(data, SIDE, SIDE, [25, 27, 26]);
    expect(at(data, 0, 0)).toEqual([25, 27, 26]);
  });

  it("does not touch a photograph that fills its frame", () => {
    const photo = picture(SIDE, (x, y) => [x * 3, y * 3, (x + y) * 2]);
    const before = photo.data.slice();
    expect(clearWhiteGround(photo.data, SIDE, SIDE, paper)).toBe(false);
    expect(photo.data).toEqual(before);
  });

  it("does not touch a photograph with a bright sky along one edge", () => {
    // White along the top quarter of the frame only: a quarter of the edge and a little more.
    const sky = picture(SIDE, (x, y) => (y < 16 ? [250, 250, 250] : [40 + x, 90, 60 + y]));
    const before = sky.data.slice();
    expect(clearWhiteGround(sky.data, SIDE, SIDE, paper)).toBe(false);
    expect(sky.data).toEqual(before);
  });

  it("does not take tinted paper for white ground", () => {
    const cream = picture(SIDE, (x, y) => (Math.hypot(x - 32, y - 32) < 20 ? [120, 30, 30] : [250, 240, 205]));
    expect(clearWhiteGround(cream.data, SIDE, SIDE, paper)).toBe(false);
  });
});
