import { describe, expect, it } from "vitest";
import { coverFromBottom, coverFromTop, planScrollStep, readingBand, stepDuration, type ReadingArea, screenStep, chapterEndTop, isPictureGap, pastPictureGap, isScrollCorrection, lineInArea } from "./smartScroll";

// 18px type at 1.8 line height.
const LINE = 32.4;

const screens: Record<string, ReadingArea> = {
  "small laptop": { height: 640, lineHeight: LINE, topInset: 12, bottomInset: 112 },
  "big monitor": { height: 1300, lineHeight: LINE, topInset: 12, bottomInset: 112 },
  "portrait monitor": { height: 1840, lineHeight: LINE, topInset: 12, bottomInset: 112 },
  "landscape phone": { height: 330, lineHeight: 28.8, topInset: 56, bottomInset: 96 },
  "large type": { height: 700, lineHeight: 57.6, topInset: 76, bottomInset: 112 }
};

describe("Smart Read's page steps", () => {
  it.each(Object.entries(screens))("turns a real page at a time on a %s", (_name, area) => {
    const band = readingBand(area);
    const usable = area.height - area.topInset - area.bottomInset;
    // Dotty's line lands near the top of what is visible, and is never hidden.
    expect(band.top).toBeGreaterThanOrEqual(area.topInset);
    expect(band.top - area.topInset).toBeLessThanOrEqual(Math.max(area.lineHeight * 1.5, usable * 0.08) + 0.01);
    // It reads to near the bottom before the page moves.
    expect(band.turn).toBeLessThanOrEqual(area.height - area.bottomInset);
    expect(band.turn).toBeGreaterThan(band.top);
    // A step moves most of a screen: the old rule moved a quarter.
    const step = planScrollStep(band.turn + 1, band.turn + 1 + area.lineHeight, area);
    expect(step).not.toBeNull();
    expect(step!).toBeGreaterThan(Math.max(area.lineHeight * 2, area.height * 0.26));
  });

  it("moves several lines at a time even with little room", () => {
    const area = screens["landscape phone"];
    const band = readingBand(area);
    expect((band.turn - band.top) / area.lineHeight).toBeGreaterThanOrEqual(3);
  });

  it("stays put while Dotty is inside the reading area", () => {
    const area = screens["small laptop"];
    const band = readingBand(area);
    expect(planScrollStep(band.top + 40, band.top + 40 + LINE, area)).toBeNull();
    expect(planScrollStep(band.turn - LINE - 1, band.turn - 1, area)).toBeNull();
  });

  it("brings Dotty back down when its line has gone above the page", () => {
    const area = screens["big monitor"];
    const step = planScrollStep(-200, -200 + LINE, area);
    expect(step).toBeLessThan(0);
    expect(-200 - step!).toBeCloseTo(readingBand(area).top, 5);
  });

  it("scrolls long distances gently, and not at all for reduced motion", () => {
    expect(stepDuration(40, false)).toBe(320);
    expect(stepDuration(3000, false)).toBe(720);
    expect(stepDuration(900, true)).toBe(0);
  });
});

describe("a screen at a time", () => {
  it("moves the window less the toolbar's strip and two lines, so the foot of one screen heads the next", () => {
    // 768 px window, 80 px under the toolbar, 32.4 px lines.
    const step = screenStep(768, 80, 32.4);
    expect(step).toBe(623);
    // The line that was second from the bottom lands just under the reading line.
    const lineTop = 768 - 2 * 32.4;
    expect(lineTop - step).toBeGreaterThanOrEqual(80);
    expect(lineTop - step).toBeLessThan(80 + 32.4);
  });

  it("still moves three lines in a window too short for that", () => {
    expect(screenStep(200, 80, 50)).toBe(150);
  });
});

describe("the end of a chapter", () => {
  it("puts its last line six tenths of the way down the window", () => {
    // A chapter of 6,000 px starting at 10,000.
    expect(chapterEndTop(10_000, 6000, 0, 768)).toBe(Math.round(16_000 - 768 * 0.6));
  });

  it("does not count the blank kept below the last line of the book", () => {
    expect(chapterEndTop(10_000, 6000, 384, 768)).toBe(Math.round(16_000 - 384 - 768 * 0.6));
  });

  it("is the chapter's own start for one shorter than that", () => {
    expect(chapterEndTop(10_000, 300, 0, 768)).toBe(10_000);
  });
});

describe("a picture in Smart Read's way", () => {
  it("is a stretch with no words taller than half the window", () => {
    // A chapter's last line ends at 460; a map of 855 px and the next heading at 1,436.
    expect(isPictureGap(460, 1436, 768)).toBe(true);
    // An ornament, a scene break, the gap above a chapter's heading.
    expect(isPictureGap(460, 460 + 201, 768)).toBe(false);
    expect(isPictureGap(460, 460 + 384, 768)).toBe(false);
    expect(isPictureGap(460, 460 + 385, 768)).toBe(true);
    // The next line of the same paragraph.
    expect(isPictureGap(460, 471, 768)).toBe(false);
    expect(isPictureGap(0, 5000, 0)).toBe(false);
  });

  it("is passed once the reader has scrolled the next line into the reading area", () => {
    const area = { height: 768, lineHeight: 32.4, topInset: 8, bottomInset: 111 };
    expect(pastPictureGap(1436, area)).toBe(false);
    expect(pastPictureGap(640, area)).toBe(false);
    expect(pastPictureGap(600, area)).toBe(true);
    expect(pastPictureGap(-200, area)).toBe(true);
  });
});

describe("epub.js keeping the text in place", () => {
  it("is a correction when the scroll position changed and nothing moved on screen", () => {
    // A chapter 1,315 px tall let go above the window; one 797 px tall fetched above it.
    expect(isScrollCorrection(-1315, 0)).toBe(true);
    expect(isScrollCorrection(797, 0)).toBe(true);
    // (A fraction of a pixel on a scaled display.)
    expect(isScrollCorrection(-1315.33, 0.34)).toBe(true);
  });

  it("is someone scrolling when the text moved with it, or when it cannot be told", () => {
    expect(isScrollCorrection(120, -120)).toBe(false);
    expect(isScrollCorrection(-600, 600)).toBe(false);
    // One pixel of auto-scroll.
    expect(isScrollCorrection(1, -1)).toBe(false);
    expect(isScrollCorrection(3, 0)).toBe(false);
    expect(isScrollCorrection(0, 0)).toBe(false);
    expect(isScrollCorrection(-1315, null)).toBe(false);
  });
});

describe("where Dotty's line is against the reading area", () => {
  const area: ReadingArea = { height: 640, lineHeight: LINE, topInset: 12, bottomInset: 112 };

  it("is in it between the toolbar's strip and Smart Read's controls", () => {
    expect(lineInArea(12, area)).toBe("in");
    expect(lineInArea(300, area)).toBe("in");
    expect(lineInArea(528, area)).toBe("in");
  });

  it("is above it when the reader has read on past Dotty", () => {
    expect(lineInArea(11, area)).toBe("above");
    expect(lineInArea(-4000, area)).toBe("above");
  });

  it("is below it when the reader went back, or Dotty ran on", () => {
    expect(lineInArea(529, area)).toBe("below");
    // Behind the controls counts: the line cannot be read there.
    expect(lineInArea(600, area)).toBe("below");
    expect(lineInArea(9000, area)).toBe("below");
  });

  it.each(Object.entries(screens))("agrees with the page steps on a %s", (_name, screen) => {
    // A line the steps would leave where it is, is in the area.
    const band = readingBand(screen);
    expect(lineInArea(band.top, screen)).toBe("in");
    expect(lineInArea(band.turn - screen.lineHeight, screen)).toBe("in");
  });
});

describe("Smart Read on a phone", () => {
  // An upright phone: 844 px of text at 18 px type, the footer's strip and the pace pill at its foot.
  const phone: ReadingArea = { height: 844, lineHeight: LINE, topInset: 8, bottomInset: 100, phone: true };

  it("lets Dotty walk down to about two thirds, and lands its line about a third down", () => {
    const band = readingBand(phone);
    const usable = phone.height - phone.topInset - phone.bottomInset;
    expect((band.top - phone.topInset) / usable).toBeCloseTo(0.3, 2);
    expect((band.turn - phone.topInset) / usable).toBeCloseTo(0.7, 2);
  });

  it("never moves for a line or two: a step is several lines, and nothing until the turn", () => {
    const band = readingBand(phone);
    for (let top = band.top; top + LINE <= band.turn; top += LINE) {
      expect(planScrollStep(top, top + LINE, phone)).toBeNull();
    }
    const step = planScrollStep(band.turn, band.turn + LINE, phone)!;
    expect(step).toBeGreaterThan(LINE * 8);
    // The line lands about a third down, in one move.
    expect(band.turn - step).toBeCloseTo(band.top, 5);
  });

  it("steps far less often than once a line over a chapter", () => {
    // Dotty reads 200 lines; count the steps and where each lands its line.
    let lineTop = readingBand(phone).top;
    let steps = 0;
    for (let line = 0; line < 200; line += 1) {
      lineTop += LINE;
      const step = planScrollStep(lineTop, lineTop + LINE, phone);
      if (step !== null) {
        steps += 1;
        lineTop -= step;
      }
      // Dotty is always on screen, above the pill.
      expect(lineTop + LINE).toBeLessThanOrEqual(phone.height - phone.bottomInset);
      expect(lineTop).toBeGreaterThanOrEqual(phone.topInset);
    }
    expect(steps).toBeLessThan(200 / 8);
  });

  it("keeps the whole-page turn on a computer", () => {
    const desk = { ...phone, phone: false };
    expect(readingBand(desk).turn).toBeGreaterThan(readingBand(phone).turn);
    expect(readingBand(desk).top).toBeLessThan(readingBand(phone).top);
  });

  it("falls back to the whole room when the type is very large", () => {
    const tiny: ReadingArea = { height: 300, lineHeight: 60, topInset: 8, bottomInset: 100, phone: true };
    const band = readingBand(tiny);
    expect(band.turn).toBeGreaterThan(band.top);
    expect(band.turn).toBeLessThanOrEqual(tiny.height - tiny.bottomInset);
  });
});

describe("What covers the text", () => {
  const box = { top: 32, bottom: 876 };

  it("counts a bar along the top only", () => {
    expect(coverFromTop(box, { top: 0, bottom: 88 })).toBe(56);
    // An upright phone's text reader: the bar at the foot, shown or slid away below the window.
    expect(coverFromTop(box, { top: 820, bottom: 900 })).toBe(0);
    expect(coverFromTop(box, { top: 900, bottom: 980 })).toBe(0);
    // A top bar slid away above the window.
    expect(coverFromTop(box, { top: -88, bottom: 0 })).toBe(0);
    expect(coverFromTop(box, null)).toBe(0);
  });

  it("counts the lowest-reaching thing over the foot", () => {
    expect(
      coverFromBottom(box, [
        { top: 787, bottom: 840 }, // the pace pill
        { top: 848, bottom: 876 }, // the footer
        { top: 900, bottom: 980 }, // a bar slid away
        { top: 0, bottom: 88 } // a bar at the top
      ])
    ).toBe(89);
    expect(coverFromBottom(box, [{ top: 820, bottom: 900 }])).toBe(56);
    expect(coverFromBottom(box, [])).toBe(0);
  });
});
