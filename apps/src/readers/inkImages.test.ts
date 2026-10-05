import { describe, expect, it } from "vitest";
import { inkKind, sampleStats } from "./inkImages";

// A made-up sample of 100 pixels: so many of each grey level (and so many transparent, so many coloured).
const sample = (levels: Array<[number, number]>, extra: { transparent?: number; red?: number } = {}) => {
  const bytes: number[] = [];
  levels.forEach(([level, count]) => {
    for (let i = 0; i < count; i += 1) {
      bytes.push(level, level, level, 255);
    }
  });
  for (let i = 0; i < (extra.transparent ?? 0); i += 1) {
    bytes.push(0, 0, 0, 0);
  }
  for (let i = 0; i < (extra.red ?? 0); i += 1) {
    bytes.push(200, 30, 30, 255);
  }
  return bytes;
};

describe("sampleStats", () => {
  it("counts paper, midtones and how flat they are", () => {
    const stats = sampleStats(sample([[255, 70], [208, 20], [205, 4], [120, 1], [0, 5]]));
    expect(stats).toMatchObject({ counted: 100, total: 100, light: 70, midtone: 25, colourful: 0 });
    expect(stats.midFlat).toBeCloseTo(24 / 25);
  });

  it("leaves transparent pixels out and counts coloured ones", () => {
    const stats = sampleStats(sample([[255, 30], [0, 10]], { transparent: 50, red: 10 }));
    expect(stats).toMatchObject({ counted: 50, total: 100, light: 30, colourful: 10 });
  });
});

describe("inkKind", () => {
  it("takes black on white for ink: a banner is a title, a tall drawing is art", () => {
    const ink = sampleStats(sample([[255, 85], [140, 5], [0, 10]]));
    expect(inkKind(ink, 350, 64)).toBe("title");
    expect(inkKind(ink, 2134, 1638)).toBe("art");
    // Small, whatever its shape: an ornament.
    expect(inkKind(ink, 200, 215)).toBe("title");
  });

  it("takes outlined letters filled with one flat grey for ink", () => {
    // A chapter number drawn as outlines with a light grey fill: 71% paper, 24% of one grey, 5% outline.
    const outlined = sampleStats(sample([[255, 71], [208, 22], [200, 2], [0, 5]]));
    expect(inkKind(outlined, 1586, 115)).toBe("title");
    // A scene-break ornament drawn in grey, no black in it at all.
    const ornament = sampleStats(sample([[255, 75], [204, 21], [170, 4]]));
    expect(inkKind(ornament, 80, 12)).toBe("title");
  });

  it("leaves a shaded drawing on white as drawn: its greys are of every level", () => {
    const pencil = sampleStats(sample([[255, 72], [220, 4], [190, 5], [160, 5], [130, 5], [100, 4], [80, 3], [30, 2]]));
    expect(inkKind(pencil, 350, 289)).toBeNull();
    expect(inkKind(pencil, 200, 150)).toBeNull();
  });

  it("leaves a photograph and a diagram on grey as drawn", () => {
    // A greyscale photograph.
    expect(inkKind(sampleStats(sample([[250, 10], [200, 20], [150, 30], [100, 25], [40, 15]])), 416, 283)).toBeNull();
    // A diagram on a flat grey ground: no paper to speak of.
    expect(inkKind(sampleStats(sample([[255, 18], [166, 60], [120, 21], [0, 1]])), 740, 1186)).toBeNull();
    // A colour picture, however pale.
    expect(inkKind(sampleStats(sample([[255, 80], [0, 10]], { red: 10 })), 300, 60)).toBeNull();
  });

  it("takes dark line art with no background for ink", () => {
    expect(inkKind(sampleStats(sample([[0, 30]], { transparent: 70 })), 300, 60)).toBe("title");
  });

  it("has nothing to say of an empty picture", () => {
    expect(inkKind(sampleStats(sample([], { transparent: 100 })), 300, 60)).toBeNull();
  });
});

describe("ink that is blended on a dark page whatever its shape", () => {
  const ink = sampleStats(sample([[255, 88], [150, 4], [0, 8]]));

  it("is a small picture: a medallion, a publisher's mark", () => {
    // 316 by 318: neither wide nor under 240 high.
    expect(inkKind(ink, 316, 318)).toBe("title");
    expect(inkKind(ink, 231, 320)).toBe("title");
    expect(inkKind(ink, 480, 480)).toBe("title");
  });

  it("is a picture that is a link, which the viewer (and its switch) cannot reach", () => {
    expect(inkKind(ink, 600, 900)).toBe("art");
    expect(inkKind(ink, 600, 900, true)).toBe("title");
  });

  it("leaves a large drawing as drawn: a map is not turned into its negative", () => {
    expect(inkKind(ink, 2134, 1638)).toBe("art");
    expect(inkKind(ink, 404, 600)).toBe("art");
  });

  it("does not make a photograph ink, linked or small", () => {
    const photo = sampleStats(sample([[250, 10], [200, 20], [150, 30], [100, 25], [40, 15]]));
    expect(inkKind(photo, 300, 300, true)).toBeNull();
    expect(inkKind(photo, 90, 45)).toBeNull();
  });
});
