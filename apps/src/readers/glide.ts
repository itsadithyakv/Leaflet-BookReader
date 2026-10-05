/**
 * A scroll the reader animates itself (an arrow key's nudge, Page Down, Smart
 * Read's page step), kept true to the text while the page changes under it.
 *
 * Scrolling is one continuous book: chapters left behind are let go and ones
 * ahead arrive, and each time epub.js moves the scroll position by the height
 * that came or went, so the text stays still. An animation that set the
 * position from where it had started undid that on its next frame: the text
 * jumped by the height of a whole chapter. A reader going down the page with
 * the arrow key lost a screen or more just after a chapter's start (the
 * chapter before last is let go a quarter of a second after scrolling rests,
 * which is when the next press is in flight).
 *
 * So a glide keeps a base that follows whatever else moved the page: each
 * frame, the difference between where the page is and where the glide last
 * put it is somebody else's move, and is kept.
 */
export type GlideState = {
  /** Where the glide counts from: its start, plus every move that was not its own. */
  base: number;
  /** Where the glide last put the page (as the page reported it back); null before its first frame. */
  lastSet: number | null;
};

export const startGlide = (from: number): GlideState => ({ base: from, lastSet: null });

/**
 * The position for this frame: `travelled` of the glide's own distance from
 * its base, after taking in any move made by something else since the last
 * frame (`actual` is where the page is now). The caller sets it and hands
 * back what the page then reports with `glideSet`.
 */
export const glideFrame = (state: GlideState, actual: number, travelled: number) => {
  if (state.lastSet !== null) {
    state.base += actual - state.lastSet;
  }
  return state.base + travelled;
};

/** After setting the position: what the page reports (it rounds to its own pixels, and stops at its ends). */
export const glideSet = (state: GlideState, reported: number) => {
  state.lastSet = reported;
};
