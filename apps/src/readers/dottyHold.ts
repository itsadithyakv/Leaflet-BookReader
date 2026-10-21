// Dotty holding still: what keeps Smart Read's dot on the word it was on while
// the reading is paused or waiting, and decides where it carries on from.
//
// What went wrong (desktop, 1.5.6 to 1.5.8, "pausing sometimes jumps a little,
// sometimes it disappears, sometimes it goes to the wrong line"):
// - Dotty is placed in the scrolling container, at a height in the book. When a
//   chapter was fetched or let go above it (scrolling while paused, the page
//   laid out again by a resize or a new type size), the text moved and Dotty
//   did not: it sat beside another line, or past the end of the page, where it
//   was tucked out of sight. Reading placed it again on the next word, so it
//   was only seen while paused. It now goes back beside its word.
// - Smart Read's word index points at the word to read next, one past the word
//   Dotty is beside. Every re-index of the page (a chapter coming in) put Dotty
//   on that next word: at the end of a line, the line below.
// - Carrying on asked whether the next word (not Dotty's) was below the reading
//   area, with the pause pill now showing over the foot of it: a word just over
//   the turn of the page read as "the reader went back to reread", and Dotty
//   left its line for the top of the window ("Dotty came back to you").

/**
 * Where Dotty goes after the words on the page are indexed again in Smart
 * Read: beside the word it was on, which is `lag` before the word to read next
 * (-1 while reading on, 0 once Dotty was placed on the word to read next).
 */
export const dottyAfterReindex = (active: number, lag: number, wordCount: number) => {
  const last = Math.max(0, wordCount - 1);
  const keep = lag === -1 || lag === 0 ? lag : 0;
  return Math.min(last, Math.max(0, active + keep));
};

/** How far Dotty is from where its word says it should be before it is moved back, in pixels. */
export const DOTTY_DRIFT_PX = 1;

/** Whether the text moved under Dotty: it is no longer beside its word (or was tucked out of sight). */
export const dottyDrifted = (
  shown: { top: number; left: number; visible: boolean } | null,
  target: { top: number; left: number }
) =>
  !shown ||
  !shown.visible ||
  !Number.isFinite(shown.top) ||
  Math.abs(shown.top - target.top) > DOTTY_DRIFT_PX ||
  (Number.isFinite(shown.left) && Math.abs(shown.left - target.left) > DOTTY_DRIFT_PX);

/**
 * Whether carrying on should read from what the reader is looking at rather
 * than from Dotty: Dotty's own line is out of sight below what can be read
 * (a full line past it, so a pill or dock coming up over the foot of the page
 * as the reading pauses does not count), and the reader moved the page (they
 * went back to reread, or scrolled a moment ago). Dotty moved off the page by
 * anything else (the page laid out again) is carried on from, and the page
 * goes to it.
 */
export const readsFromView = (
  dottyLineTop: number | null,
  area: { height: number; bottomInset: number; lineHeight: number },
  readerMovedPage: boolean
) =>
  readerMovedPage &&
  dottyLineTop !== null &&
  dottyLineTop > area.height - Math.max(0, area.bottomInset) + Math.max(12, area.lineHeight);
