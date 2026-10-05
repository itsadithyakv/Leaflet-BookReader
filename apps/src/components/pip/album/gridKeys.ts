/** Where a key in the album's grid is on screen: its left and top edges. */
export type KeyBox = { left: number; top: number };

/**
 * The key an arrow up or down goes to: the nearest across, in the nearest
 * line of keys above or below. The grid wraps to the window and is broken
 * into rows by rarity, so a line is found by where the keys are and not by
 * counting columns. Null at the first or last line.
 */
export const lineStep = (boxes: readonly KeyBox[], index: number, down: boolean): number | null => {
  const here = boxes[index];
  if (!here) {
    return null;
  }
  const gapTo = (box: KeyBox) => (down ? box.top - here.top : here.top - box.top);
  let line = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    const gap = gapTo(box);
    if (gap >= 1 && gap < line) line = gap;
  }
  if (!Number.isFinite(line)) {
    return null;
  }
  let best: number | null = null;
  let across = Number.POSITIVE_INFINITY;
  boxes.forEach((box, at) => {
    const off = Math.abs(box.left - here.left);
    if (Math.abs(gapTo(box) - line) < 1 && off < across) {
      across = off;
      best = at;
    }
  });
  return best;
};

/** The key a keypress in the grid goes to, by index; null for a key that is not the grid's, or nowhere to go. */
export const gridStep = (key: string, boxes: readonly KeyBox[], index: number): number | null => {
  switch (key) {
    case "ArrowRight":
      return index + 1 < boxes.length ? index + 1 : null;
    case "ArrowLeft":
      return index > 0 ? index - 1 : null;
    case "Home":
      return boxes.length > 0 ? 0 : null;
    case "End":
      return boxes.length > 0 ? boxes.length - 1 : null;
    case "ArrowDown":
      return lineStep(boxes, index, true);
    case "ArrowUp":
      return lineStep(boxes, index, false);
    default:
      return null;
  }
};

/** The keys the grid answers to (whether or not there is anywhere to go). */
export const isGridKey = (key: string) => ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(key);
