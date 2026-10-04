/**
 * Which highlights to draw on the page and which to take off it.
 *
 * epub.js keeps one drawn mark per place (its CFI range). Two highlights of
 * exactly the same words (the same passage highlighted twice) were both handed
 * to it: the second replaced the first in its books while the first's mark
 * stayed on the page with nothing left to remove it by. Removing one highlight
 * then took the other's colour off, and removing both left a mark that would
 * not go until the chapter was drawn again. So one mark is drawn per place;
 * when its highlight goes, the other highlight of that place takes its turn.
 */

/** Drawn already: a key (the highlight and its colour) and the place it is drawn at. */
export type DrawnHighlights = ReadonlyMap<string, string>;

export const planHighlightDraws = (drawn: DrawnHighlights, wanted: Array<{ key: string; cfi: string }>) => {
  const wantedKeys = new Set(wanted.map((item) => item.key));
  const remove: string[] = [];
  const places = new Set<string>();
  drawn.forEach((cfi, key) => {
    if (wantedKeys.has(key)) {
      places.add(cfi);
    } else {
      remove.push(key);
    }
  });
  const draw: string[] = [];
  for (const item of wanted) {
    if (drawn.has(item.key) || places.has(item.cfi)) {
      continue;
    }
    places.add(item.cfi);
    draw.push(item.key);
  }
  return { remove, draw };
};
