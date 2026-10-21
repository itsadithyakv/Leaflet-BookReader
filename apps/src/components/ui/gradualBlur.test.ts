import { describe, expect, it } from "vitest";
import { blurStack, followRows, nearestScroller, type BlurStackOptions } from "./GradualBlur";

const base: BlurStackOptions = {
  edge: "bottom",
  layers: 8,
  curve: "linear",
  strength: 2,
  exponential: true,
  saturation: 1,
  opacity: 1,
  tint: "transparent",
  duration: 0.3,
  easing: "ease-out",
};

const radiusOf = (filter: unknown) => Number(/blur\(calc\(([\d.]+)px/.exec(String(filter))?.[1]);

describe("blurStack", () => {
  it("stacks layers whose blurs add up to the full strength at the edge", () => {
    const { steps } = blurStack(base);
    expect(steps).toHaveLength(8);
    const total = Math.sqrt(steps.reduce((sum, s) => sum + radiusOf(s.backdropFilter) ** 2, 0));
    expect(total).toBeCloseTo(24, 1);
  });

  it("starts gently when exponential, and evenly when not", () => {
    const gentle = blurStack(base).steps.map((s) => radiusOf(s.backdropFilter));
    const even = blurStack({ ...base, exponential: false }).steps.map((s) => radiusOf(s.backdropFilter));
    expect(gentle[0]).toBeLessThan(even[0]);
    expect(gentle[7]).toBeGreaterThan(even[7]);
  });

  it("keeps the layer count between 1 and 16", () => {
    expect(blurStack({ ...base, layers: 0 }).steps).toHaveLength(1);
    expect(blurStack({ ...base, layers: 40 }).steps).toHaveLength(16);
  });

  it("masks each layer to its slice of the ramp, toward the chosen edge", () => {
    const { steps } = blurStack({ ...base, edge: "top", layers: 4 });
    expect(String(steps[1].maskImage)).toBe("linear-gradient(to top, transparent 25.00%, #000 50.00%)");
  });

  it("adds a wash only for a real tint, and a saturation only when asked", () => {
    expect(blurStack(base).wash).toBeNull();
    expect(blurStack({ ...base, tint: "rgb(0 0 0 / 0.5)" }).wash?.background).toBe("rgb(0 0 0 / 0.5)");
    expect(String(blurStack(base).steps[0].backdropFilter)).not.toContain("saturate");
    expect(String(blurStack({ ...base, saturation: 1.4 }).steps[0].backdropFilter)).toContain("saturate");
  });
});

describe("the edge coming and going", () => {
  it("fades each layer's opacity with the reveal, and never animates the blur itself", () => {
    const { steps, wash } = blurStack({ ...base, tint: "rgb(0 0 0 / 0.4)", opacity: 0.8 });
    for (const step of steps) {
      expect(String(step.opacity)).toBe("calc(0.8 * var(--gradual-blur-reveal, 1))");
      expect(String(step.transition)).not.toMatch(/backdrop-filter/);
      expect(String(step.backdropFilter)).not.toContain("--gradual-blur-reveal");
    }
    expect(String(wash?.opacity)).toContain("--gradual-blur-reveal");
  });
});

type Fake = { name: string; parentElement: Fake | null; children: Fake[]; scrolls?: boolean };
const tree = () => {
  const make = (name: string, parent: Fake | null, scrolls = false): Fake => {
    const node: Fake = { name, parentElement: parent, children: [], scrolls };
    parent?.children.push(node);
    return node;
  };
  const page = make("page", null, true);
  const panel = make("panel", page);
  const list = make("list", panel, true);
  const strip = make("strip", list);
  const edge = make("edge", strip);
  const overlay = make("overlay", panel);
  return { page, panel, list, strip, edge, overlay };
};

describe("nearestScroller", () => {
  const scrolls = (node: Fake) => Boolean(node.scrolls);

  it("takes a scrolling sibling first, as an overlay laid over a list", () => {
    const { overlay, list } = tree();
    expect(nearestScroller(overlay, scrolls)?.name).toBe(list.name);
  });

  it("else the nearest scrolling ancestor, as an edge held in a strip inside the list", () => {
    const { edge } = tree();
    expect(nearestScroller(edge, scrolls)?.name).toBe("list");
  });

  it("stops where it is told to", () => {
    const { edge, list, page } = tree();
    list.scrolls = false;
    expect(nearestScroller(edge, scrolls, page)).toBeNull();
    expect(nearestScroller(edge, scrolls)?.name).toBe("page");
  });
});

describe("the rows an edge watches", () => {
  it("lets go of a row taken away (a page left for another tab), and watches one put in", () => {
    const watched = new Set<unknown>();
    const observer = { observe: (node: never) => void watched.add(node), unobserve: (node: never) => void watched.delete(node) };
    const oldPage = { nodeType: 1 };
    const newPage = { nodeType: 1 };
    const text = { nodeType: 3 };
    followRows(observer, [{ addedNodes: [oldPage], removedNodes: [] }]);
    expect(watched.has(oldPage)).toBe(true);
    followRows(observer, [{ addedNodes: [newPage, text], removedNodes: [oldPage] }]);
    expect(watched.has(oldPage)).toBe(false);
    expect(watched.has(newPage)).toBe(true);
    expect(watched.has(text)).toBe(false);
  });
});
