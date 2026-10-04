/**
 * Where the garden's plots go: in rows. Two furrows across the lawn, one
 * behind the other, the back one a little shorter and set in (it is further
 * away), with the plots along them in order: plots 1, 2, 3 along the front
 * row, 4, 5, 6 along the back, each back plot between two front ones so
 * nothing hides behind anything.
 *
 * Only where things are drawn: a plot is still its number (pip/mod.rs,
 * `Planting.plot`), so every garden saved before the rows loads as it was,
 * with nothing to migrate. Pure (gardenRows.test.ts).
 */

/** A plot's sprite, as garden.js draws it. */
const PLOT_W = 28;
const PLOT_H = 34;
/** Where a plant meets the soil, down its sprite (garden.js: the soil is the last 7 rows). */
const PLANT_BASE = 27;

/** Plots along a row, at least: more only when the garden outgrows two rows of these. */
export const ROW_COLUMNS = 3;
/** Clear of the left wall, and of the rain barrel in the right-hand corner. */
const LEFT = 18;
const RIGHT = 24;
/** How far apart plots stand along the front row, at most. */
const FRONT_SPACING = 64;

export type RowPlot = {
  /** The plot's sprite box in floor pixels (the plant stands in it, its foot on the row). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0: the front row; 1: the back. */
  row: 0 | 1;
  column: number;
};

export type GardenRow = {
  row: 0 | 1;
  /** The furrow's top edge and how deep it is drawn, in floor pixels. */
  y: number;
  depth: number;
  /** From its first plot to its last dug one. */
  x0: number;
  x1: number;
};

export type GardenLayout = { plots: RowPlot[]; rows: GardenRow[] };

/**
 * The layout for `count` plot positions (the dug plots, and the next one to
 * dig if there is one), of which the first `dug` are dug. `floorY` is where
 * the lawn starts.
 */
export const gardenLayout = (levelW: number, floorY: number, count: number, dug = count): GardenLayout => {
  const columns = Math.max(ROW_COLUMNS, Math.ceil(count / 2));
  const span = levelW - LEFT - RIGHT - PLOT_W;
  // The back row is offset by half a plot's spacing, so the front row has half a step less to spread over.
  const front = Math.min(FRONT_SPACING, span / (columns - 0.5));
  const back = front * 0.9;
  const first = LEFT + PLOT_W / 2;
  // The furrows: the front one two thirds down the first strip of lawn, the back one just off the wall.
  const soil: Record<0 | 1, { y: number; depth: number }> = { 0: { y: floorY + 8, depth: 5 }, 1: { y: floorY + 2, depth: 4 } };

  const centre = (row: 0 | 1, column: number) => Math.round(row === 0 ? first + column * front : first + front * 0.45 + column * back);
  const plots: RowPlot[] = Array.from({ length: count }, (_, index) => {
    const row: 0 | 1 = index < columns ? 0 : 1;
    const column = index % columns;
    return { x: centre(row, column) - PLOT_W / 2, y: soil[row].y + 1 - PLANT_BASE, w: PLOT_W, h: PLOT_H, row, column };
  });

  const rows: GardenRow[] = ([0, 1] as const).flatMap((row) => {
    const inRow = plots.slice(0, dug).filter((plot) => plot.row === row);
    if (inRow.length === 0) return [];
    const last = inRow[inRow.length - 1];
    return [{ row, ...soil[row], x0: inRow[0].x - 2, x1: last.x + PLOT_W + 2 }];
  });
  return { plots, rows };
};
