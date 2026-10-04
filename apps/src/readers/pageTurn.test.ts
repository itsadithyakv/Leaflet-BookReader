import { describe, expect, it } from "vitest";
import { KEY_REPEAT_TURN_MS, keyTurns, pageCount, pageTurnDuration, pageTurnTarget } from "./pageTurn";

/**
 * A chapter of `pages` pages as the browser holds it: a scroll position lands
 * on device pixels (`scale` 1.25 or 1.5 leaves fractions of a CSS pixel), and
 * cannot go past the content less the container.
 */
const chapter = (pages: number, pageWidth: number, containerWidth: number, scale: number) => {
  const contentWidth = pages * pageWidth;
  const settle = (left: number) =>
    Math.round(Math.min(Math.max(0, left), contentWidth - containerWidth) * scale) / scale;
  return { contentWidth, settle };
};

/** The pages shown, turning forward from the first until the chapter is left. */
const walkForward = (pages: number, pageWidth: number, containerWidth: number, scale: number) => {
  const { contentWidth, settle } = chapter(pages, pageWidth, containerWidth, scale);
  const shown = [1];
  let left = 0;
  for (let turn = 0; turn < pages + 5; turn += 1) {
    const target = pageTurnTarget(left, pageWidth, contentWidth, 1);
    if (target === null) {
      break;
    }
    left = settle(target);
    shown.push(Math.round(left / pageWidth) + 1);
  }
  return shown;
};

/** The same walk by epub.js's own rule (what 1.1 did): a page's width on, if a whole further page fits. */
const walkForwardAsEpubJs = (pages: number, pageWidth: number, containerWidth: number, scale: number) => {
  const { contentWidth, settle } = chapter(pages, pageWidth, containerWidth, scale);
  const shown = [1];
  let left = 0;
  for (let turn = 0; turn < pages + 5; turn += 1) {
    if (!(left + containerWidth + pageWidth <= contentWidth)) {
      break;
    }
    left = settle(left + pageWidth);
    shown.push(Math.round(left / pageWidth) + 1);
  }
  return shown;
};

const upTo = (pages: number) => Array.from({ length: pages }, (_, index) => index + 1);

describe("turning pages", () => {
  it("counts a chapter's pages from its columns", () => {
    expect(pageCount(5892, 1473)).toBe(4);
    // A chapter shorter than the screen is still one page.
    expect(pageCount(1474, 1473)).toBe(1);
    expect(pageCount(900, 0)).toBe(1);
  });

  it("goes on to the last page of a chapter", () => {
    // Four pages of 1473px in a container a pixel wider: epub.js's own test
    // (2946 + 1474 + 1473 <= 5892) fails here and skipped the last page.
    expect(pageTurnTarget(2946, 1473, 5892, 1)).toBe(4419);
  });

  it("lands on the page's exact place, whatever the last turn left over", () => {
    // On a scaled display each turn can stop a fraction further on. epub.js's
    // test (2947.2 + 1473 + 1473 <= 5892) fails here too.
    expect(pageTurnTarget(2947.2, 1473, 5892, 1)).toBe(4419);
    expect(pageTurnTarget(2945.4, 1473, 5892, -1)).toBe(1473);
  });

  it("leaves the chapter only from its last and first pages", () => {
    expect(pageTurnTarget(4419, 1473, 5892, 1)).toBeNull();
    // The last page cannot scroll quite as far when the container is wider than a page.
    expect(pageTurnTarget(4418, 1473, 5892, 1)).toBeNull();
    expect(pageTurnTarget(0, 1473, 5892, -1)).toBeNull();
    expect(pageTurnTarget(1473, 1473, 5892, -1)).toBe(0);
  });

  it("turns from a position between pages to the next whole page", () => {
    expect(pageTurnTarget(1400, 1473, 5892, 1)).toBe(2946);
    expect(pageTurnTarget(1500, 1473, 5892, -1)).toBe(0);
  });

  it("shows every page of a chapter, one a turn, whatever the width and the display's scaling", () => {
    for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
      for (const pageWidth of [677, 1248, 1473, 415, 1001]) {
        for (const pages of [1, 2, 3, 19, 40]) {
          // The container as wide as a page, or a pixel wider.
          for (const extra of [0, 1]) {
            expect(walkForward(pages, pageWidth, pageWidth + extra, scale)).toEqual(upTo(pages));
          }
        }
      }
    }
  });

  it("is where 1.1 skipped the last page: epub.js's own rule, on a scaled display", () => {
    // 150% scaling, pages 677px wide: the scroll position of the 18th of 19
    // pages lands a third of a pixel on (11509.33), a whole further page no
    // longer "fits", and the turn went to the next chapter without the 19th.
    expect(walkForwardAsEpubJs(19, 677, 677, 1.5)).toEqual(upTo(18));
    expect(walkForward(19, 677, 677, 1.5)).toEqual(upTo(19));
    // A container a pixel wider than a page: the same, at any scaling.
    expect(walkForwardAsEpubJs(19, 1248, 1249, 1)).toEqual(upTo(18));
    expect(walkForward(19, 1248, 1249, 1)).toEqual(upTo(19));
    // With nothing a fraction off, epub.js's rule shows them all.
    expect(walkForwardAsEpubJs(19, 1248, 1248, 1.5)).toEqual(upTo(19));
  });

  it("turns back through every page from the last", () => {
    for (const scale of [1, 1.25, 1.5]) {
      for (const pageWidth of [677, 1248, 1001]) {
        const pages = 19;
        const { contentWidth, settle } = chapter(pages, pageWidth, pageWidth + 1, scale);
        // Where a turn back into the chapter lands: its last page.
        let left = settle(contentWidth - pageWidth);
        const shown = [Math.round(left / pageWidth) + 1];
        for (let turn = 0; turn < pages + 5; turn += 1) {
          const target = pageTurnTarget(left, pageWidth, contentWidth, -1);
          if (target === null) {
            break;
          }
          left = settle(target);
          shown.push(Math.round(left / pageWidth) + 1);
        }
        expect(shown).toEqual(upTo(pages).reverse());
      }
    }
  });

  it("turns one page for a press, and paces a held key", () => {
    // A press of its own, however soon after the last.
    expect(keyTurns(false, 0)).toBe(true);
    expect(keyTurns(false, 20)).toBe(true);
    // A held key repeats every 33ms or so: most repeats turn nothing.
    expect(keyTurns(true, 33)).toBe(false);
    expect(keyTurns(true, KEY_REPEAT_TURN_MS - 1)).toBe(false);
    expect(keyTurns(true, KEY_REPEAT_TURN_MS)).toBe(true);
    // Held for a second: the press, then a turn every fifth repeat.
    let last = 0;
    let turns = 0;
    for (let at = 0; at <= 1000; at += 33) {
      if (keyTurns(at > 0, at - last)) {
        last = at;
        turns += 1;
      }
    }
    expect(turns).toBe(7);
  });

  it("has nowhere to go without a page width", () => {
    expect(pageTurnTarget(0, 0, 5892, 1)).toBeNull();
  });

  it("does not animate for a reader who asked for less motion", () => {
    expect(pageTurnDuration(true)).toBe(0);
    expect(pageTurnDuration(false)).toBeGreaterThan(0);
  });
});
