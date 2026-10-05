/**
 * How many covers go in a row of the library's grid, from the room the grid
 * has (its own width, not the window's: the rail, the page's margins and the
 * page's widest size all come out of the window first).
 *
 * Five across a desktop window, as the grid was drawn. Fewer as it narrows,
 * so that a cover is never much under 150 px wide; more past 1,500 px, so
 * that one is never over 270. It used to be two, three or five by the
 * window's width alone, which made a cover 150 px wide in a 1,024 px window
 * and 630 px wide on an ultrawide.
 */
export const gridColumns = (width: number, gap: number) => {
  if (width >= 1500) {
    return Math.ceil((width + gap) / (WIDEST_COVER + gap));
  }
  return width >= 1040 ? 5 : width >= 760 ? 4 : width >= 520 ? 3 : 2;
};

/** The widest a cover is drawn in a grid wider than a desktop window, px. */
const WIDEST_COVER = 270;

/** A cover's width in a grid of this width, px. */
export const coverWidth = (width: number, gap: number) => {
  const columns = gridColumns(width, gap);
  return (width - gap * (columns - 1)) / columns;
};
