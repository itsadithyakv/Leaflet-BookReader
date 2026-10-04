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
