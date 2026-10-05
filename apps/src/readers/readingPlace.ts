/**
 * The reading line: the first line of text clear of the toolbar.
 *
 * In the scrolling layout epub.js names the place by the line at the very top
 * of the window, which the floating toolbar covers; a place gone to is then
 * brought down below the toolbar (`PAGE_TOP_PAD`). Taking the place from the
 * top and putting it back lower meant every round trip moved the text: a book
 * reopened without scrolling crept back some seventy pixels each time. The
 * place is taken from the same height it is put back at.
 */

/** A chapter on the page: where its frame is from the top of the scrolling window, and its height. */
export type ChapterBox = { top: number; height: number };

/** A line whose top is this little above the reading line still counts as on it (scroll positions land between pixels). */
export const LINE_TOLERANCE = 4;

/**
 * Which chapter holds the reading line, and the stretch of that chapter (in
 * its own pixels) to look for the first line in: from the reading line down to
 * the bottom of the window. A chapter that ends before the reading line is
 * passed over, and one that starts below it is read from its top.
 */
export const readingLineIn = (chapters: readonly ChapterBox[], line: number, windowHeight: number) => {
  for (let index = 0; index < chapters.length; index += 1) {
    const { top, height } = chapters[index];
    if (height <= 0 || top + height <= line) {
      continue;
    }
    if (top >= windowHeight) {
      break;
    }
    const start = Math.max(0, line - top - LINE_TOLERANCE);
    const end = Math.min(height, Math.max(start + 1, windowHeight - top));
    return { index, start, end };
  }
  return null;
};

/**
 * The place to save as where the reading is. Scrolling: the reading line
 * (see above), so that open, close, open lands on the same line every time.
 * Pages: the page's first line, which is what a page is found again by. The
 * top of the window stands in when the reading line cannot be read.
 */
export const placeToSave = (layout: "scroll" | "pages", readingLineCfi: string | null, topCfi: string | null) =>
  layout === "scroll" ? (readingLineCfi ?? topCfi) : topCfi;

/**
 * A piece of a chapter in reading order: a run of text (one text node) or a
 * picture. Tops and bottoms are in the chapter's own pixels.
 */
export type LinePiece = {
  /** Where its box is; null when it has none (hidden text). */
  box: { top: number; bottom: number } | null;
  /** How many words it holds; 0 for a picture. */
  words: number;
  /** The top of the line the nth word is drawn on; null for a word that is not drawn. */
  wordTop: (word: number) => number | null;
};

/** A picture cut by the reading line is still the place while this much of it shows below the line. */
export const PICTURE_SHOWING = 40;

/**
 * Where the reading line starts: the first word drawn at or below `start`
 * (which piece, and which of its words), or the first picture there (`word`
 * is -1).
 *
 * epub.js names a line by the space before its first word, which is drawn at
 * the end of the line above, and when a text node's last line is cut by the
 * reading line it names the start of the node, however many lines up. Either
 * way a place put back by that name showed an earlier line: at about a third
 * of scroll positions the saved place, Back and a bookmark crept back one to
 * six lines.
 */
export const firstAtLine = (pieces: Iterable<LinePiece>, start: number): { piece: number; word: number } | null => {
  let at = -1;
  for (const piece of pieces) {
    at += 1;
    const box = piece.box;
    if (!box || box.bottom <= start) {
      continue;
    }
    if (piece.words === 0) {
      if (box.top >= start || box.bottom - start >= PICTURE_SHOWING) {
        return { piece: at, word: -1 };
      }
      continue;
    }
    // Lines run down the page, so the words' tops never decrease: the first
    // at or below the line is found by halving. A word not drawn counts as above.
    let low = 0;
    let high = piece.words;
    while (low < high) {
      const middle = (low + high) >> 1;
      const top = piece.wordTop(middle);
      if (top !== null && top >= start) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    if (low < piece.words) {
      return { piece: at, word: low };
    }
    // Its last line is cut by the reading line: the place is in what follows.
  }
  return null;
};
