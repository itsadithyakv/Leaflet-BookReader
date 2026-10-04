/**
 * Two pages side by side, for comics on a wide window.
 *
 * A comic is made in facing pages: after the cover, pages go two by two. A
 * cover is shown alone, and so is a page that is wider than it is tall, which
 * is a double page drawn as one picture already. After such a page the
 * pairing starts again, as it does in the printed book.
 *
 * Which pages are wide is only known once their pictures have been read, and
 * reading every picture of a comic on opening it is the thing not to do. So
 * the pairing is worked out from what is known so far: `alone` answers true
 * or false for a page whose size has been seen and undefined for one that has
 * not, and where an answer is needed that is not known yet, `spreadOf` says
 * which page to read and is asked again. Pages never seen are taken to be
 * ordinary ones; reading on from the start, that is always right.
 */

export type SpreadAnswer =
  /** The pages shown together, in reading order: one or two. */
  | { pages: number[] }
  /** The page whose size must be known first. */
  | { need: number };

export const spreadOf = (
  page: number,
  pageCount: number,
  alone: (page: number) => boolean | undefined
): SpreadAnswer => {
  // The cover.
  if (page <= 1 || pageCount <= 1) {
    return { pages: [Math.max(1, page)] };
  }
  const self = alone(page);
  if (self === undefined) {
    return { need: page };
  }
  if (self) {
    return { pages: [page] };
  }
  // The nearest page before this one that stands alone; pairs start after it.
  let last = page - 1;
  while (last > 1 && alone(last) !== true) {
    last -= 1;
  }
  const first = (page - last - 1) % 2 === 0;
  const partner = first ? page + 1 : page - 1;
  if (partner > pageCount) {
    return { pages: [page] };
  }
  const other = alone(partner);
  if (other === undefined) {
    return { need: partner };
  }
  if (other) {
    // Only a page after this one can turn out to be wide here: one before
    // would have been `last`. The page is left without a partner.
    return { pages: [page] };
  }
  return { pages: first ? [page, partner] : [partner, page] };
};

/** Where a turn goes from the pages on show: on from the last of them, back from the first. */
export const turnFrom = (shown: number[], step: 1 | -1) =>
  step > 0 ? Math.max(...shown) + 1 : Math.min(...shown) - 1;

/** "Page 4 of 40" or "Pages 4–5 of 40". */
export const pagesLabel = (shown: number[], pageCount: number) =>
  shown.length > 1
    ? `Pages ${Math.min(...shown)}–${Math.max(...shown)} of ${pageCount}`
    : `Page ${shown[0]} of ${pageCount}`;

/**
 * Whether there is room for two pages: a window wider than it is tall. On a
 * tall window two pages would each be half the width of one, too small to read.
 */
export const roomForSpread = (availableWidth: number, availableHeight: number) =>
  availableWidth >= availableHeight * 1.15;
