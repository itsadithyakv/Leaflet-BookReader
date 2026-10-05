import { describe, expect, it } from "vitest";
import { coverWidth, gridColumns } from "./gridColumns";

const GAP = 32;

/** The grid's width in a window this wide: less the rail and the page's margins. */
const inWindow = (window: number) => window - 78 - 64;

describe("how many covers go in a row", () => {
  it("is five across a desktop window, as the grid was drawn", () => {
    expect(gridColumns(inWindow(1280), GAP)).toBe(5);
    expect(gridColumns(inWindow(1366), GAP)).toBe(5);
    expect(gridColumns(inWindow(1600), GAP)).toBe(5);
  });

  it("is fewer in a narrower one", () => {
    expect(gridColumns(inWindow(1093), GAP)).toBe(4);
    expect(gridColumns(inWindow(1024), GAP)).toBe(4);
    expect(gridColumns(inWindow(960), GAP)).toBe(4);
    expect(gridColumns(inWindow(800), GAP)).toBe(3);
    // Under the rail's breakpoint the bottom bar is used and the margins are 16 px.
    expect(gridColumns(480 - 32, 24)).toBe(2);
    expect(gridColumns(380 - 78 - 32, 24)).toBe(2);
  });

  it("is more in a wider one", () => {
    expect(gridColumns(inWindow(1920), GAP)).toBe(6);
    expect(gridColumns(2240, GAP)).toBe(8);
  });

  it("keeps a cover between about 150 and 275 px wide at every width from 520 up", () => {
    for (let width = 520; width <= 3400; width += 1) {
      const cover = coverWidth(width, GAP);
      expect(cover, `at ${width}`).toBeGreaterThanOrEqual(150);
      expect(cover, `at ${width}`).toBeLessThanOrEqual(275);
    }
  });

  it("never adds a column and takes one away as the grid widens", () => {
    let last = 0;
    for (let width = 200; width <= 3400; width += 1) {
      const columns = gridColumns(width, GAP);
      expect(columns, `at ${width}`).toBeGreaterThanOrEqual(last);
      last = columns;
    }
  });
});
