/**
 * A jump made while scrolling (next or previous chapter, the chapter list, a
 * bookmark, a search result, the progress bar), held where it landed until
 * the chapters round it have settled.
 *
 * Scrolling runs the chapters together, and epub.js, sent to a chapter that
 * is not on the page, starts the page again with that one alone, then puts
 * the chapters either side of it back. The one above goes in with a scroll
 * by its height to keep the text still, and that scroll cannot go further
 * than the page's end: with a chapter of three lines as the place gone to
 * (an epigraph, a part's title page) and the chapter after it not yet laid
 * out, the scroll stopped short, and for a second or more (on a phone) the
 * window showed the last screen of the chapter being left. Then a timer put
 * it right, unless the reader had touched the page meanwhile.
 *
 * So while a jump settles no chapter is put above the place (`holdsPrepend`:
 * the chapters below come first, and nothing has to be scrolled to keep the
 * text still), and the place is put back at the top each time the page moves
 * under it (`pinStep`), until it has stayed put a moment, or the reader takes
 * the page, or it has been long enough. Then the chapter above comes, with
 * room below it to keep the text still.
 */

/** Still for this long, the page has settled round the place: the chapter above may come. */
export const JUMP_QUIET_MS = 400;
/** The chapter above is held off no longer than this, settled or not (a chapter that never comes). */
export const JUMP_MAX_MS = 3000;
/**
 * The place is held where it was put until the reader takes the page (a
 * touch, the wheel, a key) or something else scrolls it on purpose (Smart
 * Read, read-aloud, auto-scroll: the page moved, the place where it was, and
 * not pressed against the page's end). Never by a clock that a slow phone
 * outlasts: let go after 15 s, a page whose chapters below were let go and
 * fetched again (the window dropped to the page's new end, 775 px up into
 * the chapter before) stayed there. This is a safety net only.
 */
export const JUMP_HOLD_MAX_MS = 120000;
/** How often the place is looked at while it is held. */
export const JUMP_TICK_MS = 60;

export type JumpHold = {
  /** When the jump began. */
  startedAt: number;
  /** The reader's last touch, wheel or key when it began: a later one is the reader taking the page. */
  handsOnAt: number;
  /** When the place last moved, or was put back. */
  lastMoveAt: number;
  /** Where the place was wanted at the last look (the scroll position that puts it at the top); null before it was found. */
  want: number | null;
  /** Where the page was left at the last look (after any put): a page moved since, with the place where it was, was moved by someone else. */
  left: number | null;
  /** "settling": the chapters below come first, none above; "holding": the chapter above may come, and the place is kept where it is. */
  phase: "settling" | "holding";
};

export const startJump = (now: number, handsOnAt: number): JumpHold => ({ startedAt: now, handsOnAt, lastMoveAt: now, want: null, left: null, phase: "settling" });

/** Whether chapters above are kept off the page just now: a jump is settling. */
export const holdsPrepend = (hold: JumpHold | null, now: number) => hold !== null && hold.phase === "settling" && now - hold.startedAt < JUMP_MAX_MS;

/**
 * One look at a jump being held. `want` is the scroll position that puts the
 * place where it goes, worked out from where the place is now (null: its
 * chapter is not on the page yet): the place is kept by where it is, not by
 * adding up the changes above it. `scrollTop` is where the page is.
 * `put`: set the page to `want`. `settled`: the page below has come; the
 * chapter above may come now (once). `done`: let the place go.
 */
export const pinStep = (
  hold: JumpHold,
  look: { now: number; want: number | null; scrollTop: number; handsOnAt: number; most?: number }
): { hold: JumpHold; put: boolean; settled: boolean; done: boolean } => {
  const { now, want, scrollTop, handsOnAt, most } = look;
  // The reader has the page: it is theirs from here.
  if (handsOnAt > hold.handsOnAt || now - hold.startedAt >= JUMP_HOLD_MAX_MS) {
    return { hold, put: false, settled: false, done: true };
  }
  if (want === null) {
    return { hold: { ...hold, lastMoveAt: now }, put: false, settled: false, done: false };
  }
  const moved = hold.want === null || Math.abs(want - hold.want) > 1;
  // The page moved with the place where it was: scrolled by someone else
  // (Smart Read, read-aloud, auto-scroll). Not when the page has only been
  // pressed back to its end (`most`), short of the place: the chapters below
  // it went (let go, or drawn again from nothing), and the browser moved the
  // page up with them. That is held through, and the place put back as they
  // come. Nor epub.js keeping the text still: that moves the place too.
  const pressedToEnd = typeof most === "number" && scrollTop >= most - 1 && most < want - 1;
  if (!moved && !pressedToEnd && hold.left !== null && Math.abs(scrollTop - hold.left) > 1) {
    return { hold, put: false, settled: false, done: true };
  }
  const put = Math.abs(scrollTop - want) > 1;
  const lastMoveAt = moved || put ? now : hold.lastMoveAt;
  const settling = hold.phase === "settling";
  const settled = settling && ((!moved && !put && now - lastMoveAt >= JUMP_QUIET_MS) || now - hold.startedAt >= JUMP_MAX_MS);
  return { hold: { ...hold, want, lastMoveAt, phase: settled ? "holding" : hold.phase }, put, settled, done: false };
};

/** After a look: where the page was left (the put clamped short, perhaps). */
export const noteLeft = (hold: JumpHold, scrollTop: number): JumpHold => ({ ...hold, left: scrollTop });

/**
 * The scroll position epub.js should take the page to be at while chapters
 * above are held off: far enough down that its own rule (a chapter above is
 * fetched when the top is within `reach` of the window) does not ask for one.
 * The chapters below are asked for as before, a little sooner.
 */
export const heldScrollTop = (scrollTop: number, reach: number) => Math.max(scrollTop, Math.max(0, reach) + 1);
