import { describe, expect, it } from "vitest";
import { endsSheetDrag, flickSpeed, SHEET_FLICK, sheetCloseDistance, startsSheetDrag } from "./sheetSwipe";

describe("startsSheetDrag", () => {
  const at = (dx: number, dy: number, more: Partial<{ onGrip: boolean; scrolledDown: boolean }> = {}) =>
    startsSheetDrag({ dx, dy, onGrip: false, scrolledDown: false, ...more });

  it("waits until the finger has moved past the slop", () => {
    expect(at(0, 3)).toBe("wait");
    expect(at(2, -2)).toBe("wait");
  });

  it("pulls the sheet down from its top", () => {
    expect(at(1, 10)).toBe("drag");
  });

  it("leaves an upward move, and a sideways one, to the list and its sliders", () => {
    expect(at(0, -10)).toBe("pass");
    expect(at(12, 8)).toBe("pass");
    expect(at(-12, 8, { onGrip: true })).toBe("pass");
  });

  it("never fights a list scrolled down from its top", () => {
    expect(at(0, 20, { scrolledDown: true })).toBe("pass");
  });

  it("pulls by the grip even with the list scrolled down, but only downward", () => {
    expect(at(0, 20, { onGrip: true, scrolledDown: true })).toBe("drag");
    expect(at(0, -20, { onGrip: true })).toBe("pass");
  });
});

describe("endsSheetDrag", () => {
  it("closes a sheet pulled a quarter of its height, within 64 to 120 px", () => {
    expect(sheetCloseDistance(200)).toBe(64);
    expect(sheetCloseDistance(400)).toBe(100);
    expect(sheetCloseDistance(900)).toBe(120);
    expect(endsSheetDrag(100, 0, 400)).toBe("close");
    expect(endsSheetDrag(99, 0, 400)).toBe("stay");
  });

  it("closes on a quick flick down, however short", () => {
    expect(endsSheetDrag(30, SHEET_FLICK, 600)).toBe("close");
    expect(endsSheetDrag(30, SHEET_FLICK - 0.01, 600)).toBe("stay");
  });

  it("does not take a twitch for a flick", () => {
    expect(endsSheetDrag(10, 3, 600)).toBe("stay");
  });
});

describe("flickSpeed", () => {
  it("is the speed over the last 100 ms", () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 400, y: 40 },
      { t: 450, y: 80 },
      { t: 500, y: 120 }
    ];
    expect(flickSpeed(samples)).toBeCloseTo(0.8, 5);
  });

  it("is slow after a pause before letting go", () => {
    expect(flickSpeed([{ t: 0, y: 0 }, { t: 100, y: 100 }, { t: 600, y: 102 }])).toBeLessThan(SHEET_FLICK);
  });

  it("is 0 with fewer than two moves", () => {
    expect(flickSpeed([{ t: 0, y: 0 }])).toBe(0);
  });
});
