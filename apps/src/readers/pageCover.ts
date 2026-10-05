/**
 * A PDF's first page as its cover.
 *
 * An EPUB carries its cover; a PDF carries nothing the library reads, so it
 * has a cover only if a catalogue knows the book, and a report, a paper or a
 * scan of something out of print never has one. For those the first page is
 * the cover: for a scanned book it is the scan of the cover itself, for a
 * typeset one its title page. It is drawn once, the first time the book is
 * opened after a lookup has had its turn, and kept the way every cover is.
 *
 * The arithmetic and the one judgement (is there anything on the page?) are
 * here, pure; the drawing is `coverImage` in readers/pageSources.ts.
 */

/** How wide the picture is drawn: the library's thumbnail is 360, and a 2x screen shows that at 180. */
export const COVER_WIDTH = 600;
/** JPEG quality: a page of text at 600 wide is 40 to 90 KB. */
export const COVER_QUALITY = 0.85;
/** No cover is taller than this many times its width: a very long page is drawn smaller. */
const MAX_SHAPE = 2.2;

/**
 * The scale a page (its size at scale 1, in points) is drawn at to be
 * `width` pixels across, or less for a page so tall that its height would
 * pass `MAX_SHAPE` widths. 1 for a page with no size.
 */
export const coverScale = (pageWidth: number, pageHeight: number, width = COVER_WIDTH): number => {
  if (!(pageWidth > 0) || !(pageHeight > 0) || !(width > 0)) {
    return 1;
  }
  return Math.min(width / pageWidth, (width * MAX_SHAPE) / pageHeight);
};

/** How far from the paper's own lightness a pixel must be to count as something on it. */
const MARK = 48;
/** A page with fewer marked pixels than this share of it is blank: a scan's specks, a stray rule. */
const BLANK_BELOW = 0.0005;

/**
 * Whether a drawn page has nothing on it. `data` is RGBA, row by row. The
 * paper is whatever lightness most of the page has (white for a typeset page,
 * a grey or cream for a scan, black for a dark cover); the page is blank when
 * almost nothing differs from it. A blank first page is common (the inside of
 * a cover, a scanner's first sheet) and is a worse cover than none.
 */
export const looksBlank = (data: Uint8ClampedArray | ReadonlyArray<number>, width: number, height: number): boolean => {
  const pixels = Math.min(Math.floor(data.length / 4), Math.max(0, width * height));
  if (pixels === 0) {
    return true;
  }
  const lightness = (index: number) => 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  // The paper: the commonest of 32 bands of lightness.
  const bands = new Array<number>(32).fill(0);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    bands[Math.min(31, Math.floor(lightness(pixel * 4) / 8))] += 1;
  }
  let paper = 0;
  for (let band = 1; band < 32; band += 1) {
    if (bands[band] > bands[paper]) {
      paper = band;
    }
  }
  const paperLightness = paper * 8 + 4;
  let marked = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (Math.abs(lightness(pixel * 4) - paperLightness) > MARK) {
      marked += 1;
    }
  }
  return marked / pixels < BLANK_BELOW;
};
