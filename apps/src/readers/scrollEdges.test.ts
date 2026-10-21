import { describe, expect, it } from "vitest";
import { blurStack } from "../components/ui/GradualBlur";
import { listEdge, pageEdges, PHONE_EDGE_MAX_BLUR, TOUCH_EDGE_LAYERS, type PageEdgeState } from "./scrollEdges";

/** A stylesheet read from disk (a CSS import is emptied under the test runner); named so the app's types need no Node. */
const readCss = async (path: string) => {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (path: URL, encoding: "utf8") => string };
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
};

const reading = (over: Partial<PageEdgeState> = {}): PageEdgeState => ({
  paged: false,
  speed: false,
  phone: false,
  touch: false,
  moving: false,
  ...over
});

describe("the page's scroll edges", () => {
  it("are drawn only where the text scrolls under something", () => {
    expect(pageEdges(reading({ paged: true }))).toEqual([]);
    expect(pageEdges(reading({ speed: true }))).toEqual([]);
    expect(pageEdges(reading()).map((ramp) => ramp.edge)).toEqual(["bar", "top", "foot"]);
    expect(pageEdges(reading({ phone: true, touch: true })).map((ramp) => ramp.edge)).toEqual(["top", "foot"]);
  });

  it("fade into the page's own colour, hide at the book's ends, and take nothing from the page's controls", () => {
    for (const ramp of [...pageEdges(reading()), ...pageEdges(reading({ phone: true, touch: true }))]) {
      expect(ramp.props.tint).toMatch(/^var\(--reader-edge-tint(-bar)?\)$/);
      expect(ramp.props.autoHide).toBe(true);
      // Over the book, under the dock (z 30), the footer (20) and the cards.
      expect(ramp.props.zIndex).toBeLessThan(10);
    }
  });

  it("cost a phone little: few layers, a soft blur, none while the text is moved for the reader", () => {
    for (const ramp of pageEdges(reading({ phone: true, touch: true }))) {
      expect(ramp.props.layers).toBeLessThanOrEqual(TOUCH_EDGE_LAYERS);
      expect((ramp.props.strength ?? 0) * 12).toBeLessThanOrEqual(PHONE_EDGE_MAX_BLUR);
      expect(ramp.tintOnly).toBe(false);
    }
    expect(pageEdges(reading({ phone: true, touch: true, moving: true })).every((ramp) => ramp.tintOnly)).toBe(true);
    // A tablet reads the desktop's layout by finger: fewer layers there too, and the same rest while moving.
    expect(pageEdges(reading({ touch: true })).every((ramp) => (ramp.props.layers ?? 0) <= 5)).toBe(true);
    expect(pageEdges(reading({ touch: true, moving: true })).every((ramp) => ramp.tintOnly)).toBe(true);
    // A mouse's screen keeps the blur while Smart Read moves the text.
    expect(pageEdges(reading({ moving: true })).some((ramp) => ramp.tintOnly)).toBe(false);
  });

  it("leave the line being read sharp: the blur grows toward the edge", () => {
    const bar = pageEdges(reading()).find((ramp) => ramp.edge === "bar")!;
    const { steps } = blurStack({
      edge: "top",
      layers: bar.props.layers ?? 1,
      curve: bar.props.curve ?? "linear",
      strength: bar.props.strength ?? 1,
      exponential: bar.props.exponential ?? true,
      saturation: 1,
      opacity: 1,
      tint: "transparent",
      duration: 0.3,
      easing: "ease-out"
    });
    const radius = (step: (typeof steps)[number]) => Number(/blur\(calc\(([\d.]+)px/.exec(String(step.backdropFilter))?.[1]);
    // The slice farthest from the bar (the first layer) barely blurs; the one at the bar the most.
    expect(radius(steps[0])).toBeLessThan(1);
    expect(radius(steps[steps.length - 1])).toBeGreaterThan(radius(steps[0]));
  });

  it("sit on the strip a phone's text stops at", () => {
    const foot = pageEdges(reading({ phone: true, touch: true })).find((ramp) => ramp.edge === "foot")!;
    expect(foot.props.style?.bottom).toBe("var(--reader-text-foot, 0px)");
  });
});

describe("a panel's list edges", () => {
  it("fade into the panel's tint, without a blur (the panel is glass: its backdrop root)", () => {
    for (const position of ["top", "bottom"] as const) {
      const edge = listEdge(position);
      expect(edge.position).toBe(position);
      expect(edge.autoHide).toBe(true);
      expect(edge.strength).toBe(0);
      expect(edge.tint).toContain("--reader-glass-tint-strong");
    }
  });
});

describe("the reader's glass sheet", () => {
  it("drops the ramps' blur while the text is moved for the reader, and a list's blur always", async () => {
    const css = await readCss("./glass.css");
    expect(css).toMatch(/\.reader-edge\.is-tint-only \.gradual-blur-layer\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.reader-list-edge \.gradual-blur-layer\s*\{\s*display:\s*none;/);
  });

  it("bends nothing by finger, and nothing that scales", async () => {
    const css = await readCss("./glass.css");
    const lens = /([^{}]*)\{\s*--reader-lens:/.exec(css)?.[1] ?? "";
    expect(lens).toContain(':not([data-input="touch"])');
    expect(lens).toContain(".glass-refracts");
    // The dock scales (small until the pointer comes): never the lens.
    const dock = /([^{}]*\.reader-chapter-dock > div[^{}]*)\{([^}]*)\}/g;
    for (const [, selector, body] of css.matchAll(dock)) {
      if (/--reader-lens/.test(body)) throw new Error(`the dock bends in: ${selector.trim()}`);
    }
  });

  it("lets the desktop toolbar's capsules fade themselves, never the bar", async () => {
    const css = await readCss("./glass.css");
    expect(css).toMatch(/:not\(\.page-reader\):not\(\[data-shape\]\) \.reader-toolbar\.reader-toolbar\.reader-toolbar\s*\{[^}]*backdrop-filter:\s*none;[^}]*opacity:\s*1;[^}]*filter:\s*none;/);
    expect(css).toMatch(/\.reader-chrome-hidden:not\(\.page-reader\):not\(\[data-shape\]\) :is\(\.reader-toolbar-group, \.reader-toolbar-title\)\s*\{[^}]*opacity:\s*0;/);
  });
});
