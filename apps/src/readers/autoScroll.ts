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
