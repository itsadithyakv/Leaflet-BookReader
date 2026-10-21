import { describe, expect, it } from "vitest";
import { buildGlassFilter, displacementMap, glassCanRefract } from "./glassRefraction";

const decode = (url: string) => decodeURIComponent(url.replace("data:image/svg+xml,", ""));

describe("displacementMap", () => {
  it("draws the map at the surface's size, with a calm centre inset by the edge", () => {
    const svg = decode(displacementMap(300, 60, 30, {}, "t"));
    expect(svg).toContain('width="300" height="60"');
    // 7% of the shorter side, halved: 2.1 px of bending edge.
    expect(svg).toContain('<rect x="2.1" y="2.1" width="295.8" height="55.8" rx="30"');
    expect(svg).toContain("hsl(0 0% 50% / 0.93)");
  });

  it("keeps the radius inside the surface", () => {
    expect(decode(displacementMap(40, 20, 99, {}, "t"))).toContain('rx="10"');
  });
});

// No DOM in the test runner: just enough of one to build the filter into.
type FakeNode = { tag: string; attrs: Record<string, string>; children: FakeNode[] };
const fakeDefs = () => {
  const node = (tag: string): FakeNode & { setAttribute: (k: string, v: string) => void; appendChild: (c: FakeNode) => void } => {
    const n = {
      tag,
      attrs: {} as Record<string, string>,
      children: [] as FakeNode[],
      setAttribute: (k: string, v: string) => void (n.attrs[k] = v),
      appendChild: (c: FakeNode) => void n.children.push(c),
    };
    return n;
  };
  const defs = node("defs") as ReturnType<typeof node> & { ownerDocument: unknown };
  defs.ownerDocument = { createElementNS: (_ns: string, tag: string) => node(tag) };
  return defs;
};
const all = (root: FakeNode, tag: string): FakeNode[] =>
  root.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...all(c, tag)]);

describe("buildGlassFilter", () => {
  it("bends each colour by its own amount, and frosts only when asked", () => {
    const defs = fakeDefs();
    const update = buildGlassFilter(defs as unknown as SVGElement, "g1");
    update(200, 50, 25, { distortionScale: -100 });
    expect(all(defs, "feDisplacementMap").map((n) => n.attrs.scale)).toEqual(["-100", "-90", "-80"]);
    expect(all(defs, "feGaussianBlur")[0].attrs.stdDeviation).toBe("0");
    expect(all(defs, "feImage")[0].attrs.href).toMatch(/^data:image\/svg\+xml,/);
    expect(all(defs, "feColorMatrix")[1].attrs.values).toBe("0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0");
  });
});

describe("where the map lies", () => {
  it("is laid over the surface in px from its corner (a share of the window was askew)", () => {
    const defs = fakeDefs();
    buildGlassFilter(defs as unknown as SVGElement, "g2")(335.4, 56, 28, {});
    const image = all(defs, "feImage")[0];
    expect(image.attrs.width).toBe("335");
    expect(image.attrs.height).toBe("56");
    expect(defs.children[0].attrs.primitiveUnits).toBeUndefined();
  });

  it("is stretched over any surface in its bounding box for the shared lenses", () => {
    const defs = fakeDefs();
    buildGlassFilter(defs as unknown as SVGElement, "g3", true)(240, 64, 32, { distortionScale: -0.2, greenOffset: 0.01, blueOffset: 0.02 });
    expect(defs.children[0].attrs.primitiveUnits).toBe("objectBoundingBox");
    const image = all(defs, "feImage")[0];
    expect([image.attrs.width, image.attrs.height]).toEqual(["1", "1"]);
    all(defs, "feDisplacementMap").forEach((n, i) => expect(Number(n.attrs.scale)).toBeCloseTo([-0.2, -0.19, -0.18][i], 6));
  });
});

describe("glassCanRefract", () => {
  it("is off outside Chromium (the test DOM is not one)", () => {
    expect(glassCanRefract()).toBe(false);
  });
});
