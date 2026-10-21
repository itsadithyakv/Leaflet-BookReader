import { describe, expect, it } from "vitest";
import { dottyAfterReindex, dottyDrifted, readsFromView, DOTTY_DRIFT_PX } from "./dottyHold";
import { lineInArea, readingBand, type ReadingArea } from "./smartScroll";

describe("Dotty through a re-index of the page (a chapter coming in, the page laid out again)", () => {
  it("stays beside the word it was on, not the word to read next", () => {
    // Reading on: Dotty is beside word 41, the next to read is 42.
    expect(dottyAfterReindex(42, -1, 1000)).toBe(41);
    // The same text renumbered (a chapter fetched above): both moved by the same amount.
    expect(dottyAfterReindex(42 + 3000, -1, 4000)).toBe(3041);
    // Placed on the word to read next (a drag, a catch-up, "read from here"): stays on it.
    expect(dottyAfterReindex(42, 0, 1000)).toBe(42);
  });

  it("is held inside the words on the page", () => {
    // Every word read (one past the end): beside the last.
    expect(dottyAfterReindex(1000, -1, 1000)).toBe(999);
    expect(dottyAfterReindex(0, -1, 1000)).toBe(0);
    expect(dottyAfterReindex(5, -1, 0)).toBe(0);
    // A lag that is not one of the two Dotty can have is not trusted.
    expect(dottyAfterReindex(42, -7, 1000)).toBe(42);
  });
});

describe("Dotty when the text moves under it while paused", () => {
  const target = { top: 4321.5, left: 41 };

  it("is moved back when it is beside another line, or was tucked away", () => {
    expect(dottyDrifted({ top: 4321.5, left: 41, visible: true }, target)).toBe(false);
    expect(dottyDrifted({ top: 4321.5 + DOTTY_DRIFT_PX, left: 41, visible: true }, target)).toBe(false);
    // A chapter of 240 px fetched in above: the text went down, Dotty did not.
    expect(dottyDrifted({ top: 4081.5, left: 41, visible: true }, target)).toBe(true);
    // Tucked out of sight as stranded past the end of the page.
    expect(dottyDrifted({ top: -28, left: 41, visible: false }, target)).toBe(true);
    expect(dottyDrifted({ top: 4321.5, left: 41, visible: false }, target)).toBe(true);
    // Not made yet, or never placed.
    expect(dottyDrifted(null, target)).toBe(true);
    expect(dottyDrifted({ top: Number.NaN, left: Number.NaN, visible: true }, target)).toBe(true);
    // The column moved sideways (a new line length).
    expect(dottyDrifted({ top: 4321.5, left: 120, visible: true }, target)).toBe(true);
  });
});

describe("carrying on from Dotty or from what the reader is looking at", () => {
  // A desktop window: 800 px of text, 30 px lines, the dock at the foot.
  const running: ReadingArea = { height: 800, lineHeight: 30, topInset: 8, bottomInset: 60 };
  // Paused: the pace pill comes up over the foot of the page.
  const paused: ReadingArea = { ...running, bottomInset: 116 };

  it("carries on from Dotty on the last line read before the page turns, though the pause pill now covers the foot", () => {
    // The lowest a line Dotty reads can be before the page steps (its foot at the turn).
    const lastLineTop = readingBand(running).turn - running.lineHeight;
    expect(readsFromView(lastLineTop, paused, false)).toBe(false);
    expect(readsFromView(lastLineTop, paused, true)).toBe(false);
    // The line below it (where the word to read next can be) counted as "below the page" by the
    // old test, and Dotty left its line for the top of the window on Space.
    expect(lineInArea(lastLineTop + running.lineHeight, paused)).toBe("below");
    expect(readsFromView(lastLineTop + running.lineHeight, paused, true)).toBe(false);
  });

  it("reads from the view when the reader went back above Dotty", () => {
    // Dotty a screen below the window.
    expect(readsFromView(1600, paused, true)).toBe(true);
  });

  it("goes back to Dotty when the page moved without the reader (laid out again at a new size)", () => {
    expect(readsFromView(1600, paused, false)).toBe(false);
  });

  it("goes back to Dotty when its word is not on the page to measure", () => {
    expect(readsFromView(null, paused, true)).toBe(false);
  });
});
