/** Auto-scroll: its pace, and the default a reader tunes it to. */

/** Auto-scroll's own default, remembered across books once the reader tunes it. */
export const AUTO_SCROLL_DEFAULT_KEY = "leaflet.reader.autoScrollSpeed";
/** Auto-scroll steps back while the reader scrolls by hand, for this long. */
export const AUTO_SCROLL_YIELD_BACK_MS = 3000;
export const AUTO_SCROLL_YIELD_AHEAD_MS = 1200;
/** Retuning from corrections happens at most this often. */
export const AUTO_SCROLL_TUNE_COOLDOWN_MS = 12_000;

/**
 * Auto-scroll pace in lines of text per minute. The slider (0..100) sets this;
 * pixels follow from the height of a line (`lineHeightPx` in readerTypes: the
 * type size and the line spacing), so bigger or airier type scrolls faster in
 * pixels and exactly as fast in reading.
 */
export const autoScrollLinesPerMinute = (speed: number) =>
  Math.round((3 + Math.min(100, Math.max(0, speed)) * 0.45) * 1.852);
export const autoScrollPixelsPerSecond = (speed: number, linePx: number) =>
  (autoScrollLinesPerMinute(speed) * linePx) / 60;

/** The slider position for a pace in lines a minute: the other way from `autoScrollLinesPerMinute`. */
export const autoScrollSpeedForLines = (linesPerMinute: number) =>
  Math.round(Math.min(100, Math.max(0, (linesPerMinute / 1.852 - 3) / 0.45)));

export const readAutoScrollDefault = () => {
  try {
    const value = Number(localStorage.getItem(AUTO_SCROLL_DEFAULT_KEY));
    return Number.isFinite(value) && value > 0 ? Math.min(100, value) : 35;
  } catch {
    return 35;
  }
};

/**
 * How far auto-scroll moves the page this frame, out of what it has carried
 * up (`carry`, in CSS pixels): whole pixels of the screen, not of the page.
 * It used to move only by whole CSS pixels, and at a reading pace that is
 * one step every third or fourth frame (36 lines a minute is 17 px a
 * second): on a phone, where a CSS pixel is two or three of the screen's,
 * the text moved in small, uneven jerks. A screen pixel at a time it moves
 * on most frames, by a third as much. The page lands on screen pixels
 * anyway (a step of one CSS pixel at 150% went 1.33).
 */
export const autoScrollStep = (carry: number, pixelRatio: number) => {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio >= 1 ? pixelRatio : 1;
  // (A hair over, so 1 / 2.625 * 2.625 counts as the one screen pixel it is.)
  return carry > 0 ? Math.floor(carry * ratio + 1e-6) / ratio : 0;
};

/**
 * What a step counts as done: what the page really moved. A step the page
 * did not take is counted only when it was a whole CSS pixel or more (the
 * end of what is loaded, as before); a smaller one is kept, and goes into
 * the next, where a page that does not scroll in screen pixels takes it.
 */
export const autoScrollCounted = (step: number, moved: number) => (moved > 0 ? moved : step >= 1 ? step : 0);
