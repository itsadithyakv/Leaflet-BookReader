import { describe, expect, it } from "vitest";
import { pagesLabel, roomForSpread, spreadOf, turnFrom } from "./pageSpread";

/** A comic whose wide pages are given; every page's size is known. */
const known = (wide: number[]) => (page: number) => wide.includes(page);

/** Reads pages as `spreadOf` asks for them, as the comic source does; returns the answer and what was read. */
const reading = (page: number, pageCount: number, wide: number[], seen: number[] = []) => {
  const sizes = new Map<number, boolean>(seen.map((n) => [n, wide.includes(n)]));
  const read: number[] = [];
  for (let turn = 0; turn < 10; turn += 1) {
    const answer = spreadOf(page, pageCount, (n) => sizes.get(n));
    if ("pages" in answer) {
      return { pages: answer.pages, read };
    }
    read.push(answer.need);
    sizes.set(answer.need, wide.includes(answer.need));
  }
  throw new Error("spreadOf never settled");
};

describe("two pages side by side", () => {
  it("shows the cover alone and pairs the pages after it", () => {
    const alone = known([]);
    expect(spreadOf(1, 40, alone)).toEqual({ pages: [1] });
    expect(spreadOf(2, 40, alone)).toEqual({ pages: [2, 3] });
    expect(spreadOf(3, 40, alone)).toEqual({ pages: [2, 3] });
    expect(spreadOf(4, 40, alone)).toEqual({ pages: [4, 5] });
    expect(spreadOf(39, 40, alone)).toEqual({ pages: [38, 39] });
  });

  it("shows a last page with no partner alone", () => {
    expect(spreadOf(40, 40, known([]))).toEqual({ pages: [40] });
    expect(spreadOf(1, 1, known([]))).toEqual({ pages: [1] });
  });

  it("shows a wide page alone and starts the pairs again after it", () => {
    // Page 6 is a double page drawn as one picture.
    const alone = known([6]);
    expect(spreadOf(4, 40, alone)).toEqual({ pages: [4, 5] });
    expect(spreadOf(6, 40, alone)).toEqual({ pages: [6] });
    expect(spreadOf(7, 40, alone)).toEqual({ pages: [7, 8] });
    expect(spreadOf(8, 40, alone)).toEqual({ pages: [7, 8] });
    expect(spreadOf(9, 40, alone)).toEqual({ pages: [9, 10] });
  });

  it("leaves a page alone when the one it would face is wide", () => {
    // 2 and 3 pair; 4 would face 5, which is wide.
    const alone = known([5]);
    expect(spreadOf(4, 40, alone)).toEqual({ pages: [4] });
    expect(spreadOf(5, 40, alone)).toEqual({ pages: [5] });
    expect(spreadOf(6, 40, alone)).toEqual({ pages: [6, 7] });
  });

  it("asks for the sizes it needs, and no others", () => {
    expect(reading(2, 40, [])).toEqual({ pages: [2, 3], read: [2, 3] });
    expect(reading(3, 40, [], [2])).toEqual({ pages: [2, 3], read: [3] });
    // Jumping to page 21 of a comic not yet read: it and the page it faces.
    expect(reading(21, 40, [])).toEqual({ pages: [20, 21], read: [21, 20] });
    expect(reading(6, 40, [6])).toEqual({ pages: [6], read: [6] });
  });

  it("finds out that the page before is wide, and pairs onward from it", () => {
    // Coming to page 7 without having seen page 6, which is wide.
    expect(reading(7, 40, [6])).toEqual({ pages: [7, 8], read: [7, 6, 8] });
  });

  it("turns on from the last page shown and back from the first", () => {
    expect(turnFrom([2, 3], 1)).toBe(4);
    expect(turnFrom([2, 3], -1)).toBe(1);
    expect(turnFrom([6], 1)).toBe(7);
    expect(turnFrom([6], -1)).toBe(5);
  });

  it("names what is on show", () => {
    expect(pagesLabel([4], 40)).toBe("Page 4 of 40");
    expect(pagesLabel([4, 5], 40)).toBe("Pages 4–5 of 40");
  });

  it("is for a wide window", () => {
    expect(roomForSpread(1400, 800)).toBe(true);
    expect(roomForSpread(700, 900)).toBe(false);
    expect(roomForSpread(820, 800)).toBe(false);
  });
});
