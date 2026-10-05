import { describe, expect, it } from "vitest";
import { NOT_HELD, STILL_MS, holdsFetching, isOnScrollbar, letGo, pageScrolled, pressOn } from "./scrollbarHold";

describe("the scrollbar, held", () => {
  it("holds fetching from the press, through the drag", () => {
    let hold = pressOn(true, 1000);
    expect(holdsFetching(hold, 1000)).toBe(true);
    // Dragged: the page scrolls every frame or so.
    for (let at = 1016; at <= 3000; at += 16) {
      hold = pageScrolled(hold, at);
      expect(holdsFetching(hold, at)).toBe(true);
    }
    // And for a moment after the last movement.
    expect(holdsFetching(hold, 3000 + STILL_MS - 1)).toBe(true);
  });

  it("lets fetching go on at once when the thumb is let go", () => {
    const hold = pageScrolled(pressOn(true, 1000), 2000);
    expect(holdsFetching(letGo(), 2001)).toBe(false);
    expect(holdsFetching(hold, 2001)).toBe(true);
  });

  it("held still at the end for ten seconds: fetching resumes by itself, once the page has been still", () => {
    // Dragged to the bottom by 1,400; the pointer then rests there, button down.
    let hold = pressOn(true, 1000);
    hold = pageScrolled(hold, 1400);
    expect(holdsFetching(hold, 1400 + STILL_MS - 1)).toBe(true);
    expect(holdsFetching(hold, 1400 + STILL_MS)).toBe(false);
    expect(holdsFetching(hold, 11_400)).toBe(false);
    // Moved again, still pressed: held again, while it moves.
    hold = pageScrolled(hold, 11_500);
    expect(holdsFetching(hold, 11_600)).toBe(true);
  });

  it("never holds for good when the release is not reported", () => {
    // Pressed, dragged for two seconds, let go without any event arriving.
    let hold = pressOn(true, 0);
    for (let at = 16; at <= 2000; at += 16) {
      hold = pageScrolled(hold, at);
    }
    expect(holdsFetching(hold, 2000 + STILL_MS)).toBe(false);
    // An hour later, the same.
    expect(holdsFetching(hold, 3_600_000)).toBe(false);
  });

  it("is not started by a press anywhere but the scrollbar, which also ends one", () => {
    expect(holdsFetching(pressOn(false, 1000), 1001)).toBe(false);
    const held = pressOn(true, 1000);
    expect(holdsFetching(held, 1100)).toBe(true);
    expect(holdsFetching(pressOn(false, 1100), 1101)).toBe(false);
  });

  it("is ended by the wheel (or a key), and ordinary scrolling never starts one", () => {
    let hold = pressOn(true, 1000);
    hold = pageScrolled(hold, 1100);
    // The reader turns the wheel: the reader calls letGo.
    hold = letGo();
    hold = pageScrolled(hold, 1116);
    hold = pageScrolled(hold, 1132);
    expect(hold).toBe(NOT_HELD);
    expect(holdsFetching(hold, 1132)).toBe(false);
  });

  it("knows a press on the scrollbar from one on the page", () => {
    // A container 992 px wide with a 15 px scrollbar on its right: client width 977.
    expect(isOnScrollbar(985, 977)).toBe(true);
    expect(isOnScrollbar(977, 977)).toBe(true);
    expect(isOnScrollbar(500, 977)).toBe(false);
    // On the left, where a right-to-left page draws it.
    expect(isOnScrollbar(-8, 977)).toBe(true);
  });
});
