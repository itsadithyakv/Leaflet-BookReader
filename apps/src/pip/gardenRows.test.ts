import { describe, expect, it } from "vitest";
import { ROW_COLUMNS, gardenLayout } from "./gardenRows";

const W = 240;
const FLOOR = 96;

describe("the garden's rows", () => {
  it("puts the first plots along the front row and the next along the back, in order", () => {
    const { plots } = gardenLayout(W, FLOOR, 6);
    expect(plots.map((plot) => plot.row)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(plots.map((plot) => plot.column)).toEqual([0, 1, 2, 0, 1, 2]);
    // Left to right along each row.
    expect(plots[0].x).toBeLessThan(plots[1].x);
    expect(plots[1].x).toBeLessThan(plots[2].x);
    expect(plots[3].x).toBeLessThan(plots[4].x);
    expect(plots[4].x).toBeLessThan(plots[5].x);
  });

  it("keeps every plot where it was as the garden grows: nothing shuffles", () => {
    const small = gardenLayout(W, FLOOR, 4, 3).plots;
    const full = gardenLayout(W, FLOOR, 6).plots;
    small.forEach((plot, index) => expect(plot).toEqual(full[index]));
  });

  it("stands the back row behind, higher and between the front plots", () => {
    const { plots } = gardenLayout(W, FLOOR, 6);
    const [front, , , back] = plots;
    expect(back.y).toBeLessThan(front.y);
    // Each back plot's middle falls between two front plots' middles.
    for (let column = 0; column < ROW_COLUMNS - 1; column += 1) {
      const middle = plots[3 + column].x + 14;
      expect(middle).toBeGreaterThan(plots[column].x + 14);
      expect(middle).toBeLessThan(plots[column + 1].x + 14);
    }
    // Further away, the back row's plots stand closer together.
    expect(plots[4].x - plots[3].x).toBeLessThan(plots[1].x - plots[0].x);
  });

  it("keeps plots apart along a row, on the lawn and clear of the barrel", () => {
    for (const count of [3, 4, 5, 6, 7, 8]) {
      const { plots } = gardenLayout(W, FLOOR, count);
      for (const plot of plots) {
        expect(plot.x).toBeGreaterThanOrEqual(4);
        expect(plot.x + plot.w).toBeLessThanOrEqual(W - 20);
        // The plant's foot is on the lawn.
        expect(plot.y + 27).toBeGreaterThan(FLOOR);
        expect(plot.y + plot.h).toBeLessThanOrEqual(120);
      }
      for (const row of [0, 1]) {
        const inRow = plots.filter((plot) => plot.row === row);
        for (let index = 1; index < inRow.length; index += 1) expect(inRow[index].x - inRow[index - 1].x).toBeGreaterThanOrEqual(28);
      }
    }
  });

  it("tills a row only as far as its dug plots", () => {
    const three = gardenLayout(W, FLOOR, 4, 3);
    expect(three.rows.map((row) => row.row)).toEqual([0]);
    expect(three.rows[0].x0).toBe(three.plots[0].x - 2);
    expect(three.rows[0].x1).toBe(three.plots[2].x + 30);
    const five = gardenLayout(W, FLOOR, 6, 5);
    expect(five.rows.map((row) => row.row)).toEqual([0, 1]);
    expect(five.rows[1].x1).toBe(five.plots[4].x + 30);
    // The back furrow is behind the front one and drawn a little thinner.
    expect(five.rows[1].y).toBeLessThan(five.rows[0].y);
    expect(five.rows[1].depth).toBeLessThan(five.rows[0].depth);
  });

  it("has no rows in a garden with nothing dug", () => {
    expect(gardenLayout(W, FLOOR, 0)).toEqual({ plots: [], rows: [] });
  });
});
