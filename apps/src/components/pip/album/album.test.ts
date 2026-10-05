import { describe, expect, it } from "vitest";
import { buildAlbum, type ExpeditionSession } from "../../../pip/expedition";
import { gridStep, isGridKey, lineStep, type KeyBox } from "./gridKeys";
import {
  NOTHING_FOUND,
  bookOf,
  broughtBackText,
  countText,
  entryLabel,
  firstFoundText,
  ordinal,
  tallyText,
  titleOf,
  whereText
} from "./words";

const session = (id: string, minutes: number, over: Partial<ExpeditionSession> = {}): ExpeditionSession => ({
  id,
  styleSeed: id,
  minutes,
  endedReason: "completed",
  clean: true,
  startedAt: "2026-09-12T10:00:00",
  endedAt: "2026-09-12T10:30:00",
  title: "Mistborn",
  bookId: "book-1",
  ...over
});

describe("what the album says", () => {
  const album = buildAlbum([
    session("one", 30),
    session("two", 30, { endedAt: "2026-09-13T10:30:00" }),
    session("three", 30, { endedAt: "2026-09-14T10:30:00" })
  ]);
  const found = album.finds[album.finds.length - 1];

  it("says when, in which session and how far a thing was first found", () => {
    expect(firstFoundText(found)).toBe("First found 12 Sep 2026, in a 30-minute session with Mistborn. She got as far as the hills.");
    // The library's title for the book, when it has one now.
    expect(firstFoundText(found, new Map([["book-1", "The Final Empire"]]))).toContain("with The Final Empire.");
    expect(bookOf({ ...found, title: null, bookId: null })).toBeNull();
    expect(firstFoundText({ ...found, title: null, bookId: null })).toBe(
      "First found 12 Sep 2026, in a 30-minute session. She got as far as the hills."
    );
    expect(firstFoundText({ ...found, at: "not a time" })).toBe("First found, in a 30-minute session with Mistborn. She got as far as the hills.");
  });

  it("labels a thing for a screen reader, found or not", () => {
    const entry = album.entries.find((item) => item.find.id === found.find.id)!;
    expect(entryLabel(entry)).toMatch(new RegExp(`^${titleOf(found.find.name)}, [a-z]+, found (once|\\d+ times), first on 12 Sep 2026$`));
    const missing = album.entries.find((item) => item.count === 0)!;
    expect(entryLabel(missing)).toMatch(/^Not found yet, (common|uncommon|rare|epic|legendary)$/);
    // The name of a thing not found yet is not given away.
    expect(entryLabel(missing)).not.toContain(titleOf(missing.find.name));
  });

  it("counts, in words", () => {
    expect(countText(1)).toBe("Found once.");
    expect(countText(3)).toBe("Found 3 times.");
    expect(tallyText({ rarity: "common", found: 9, total: 14, left: 5 })).toBe("9 of 14 · 5 to find");
    expect(tallyText({ rarity: "legendary", found: 4, total: 4, left: 0 })).toBe("All 4 found");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
      "111th"
    ]);
  });

  it("says where a rarity not found yet turns up", () => {
    expect(whereText("common")).toBe("Common things turn up on any trip of 5 minutes or more.");
    expect(whereText("rare")).toBe(
      "Rare things are found from the lane on: a session of 10 minutes or more, read to the end. The longer she is out, the likelier."
    );
    expect(whereText("legendary")).toContain("from the woods on: a session of 20 minutes or more");
  });

  it("says what she brought back at the end of a session, and kindly when nothing", () => {
    const first = broughtBackText(found, 1);
    expect(first.headline).toBe(`Pip found: ${found.find.name}`);
    expect(first.detail).toMatch(/^(Common|Uncommon|Rare|Epic|Legendary) · as far as the hills · new in her album$/);
    expect(broughtBackText(found, 3).detail).toMatch(/· her 3rd \(x3\)$/);
    expect(NOTHING_FOUND).toBe("Pip wasn't out long enough to find anything this time. 5 minutes of reading and she comes back with something.");
  });
});

describe("the grid's keys", () => {
  // By where they are: five across, two more on the line under them, then three in the next row.
  const boxes: KeyBox[] = [
    ...[0, 1, 2, 3, 4].map((column) => ({ left: column * 70, top: 40 })),
    ...[0, 1].map((column) => ({ left: column * 70, top: 110 })),
    ...[0, 1, 2].map((column) => ({ left: column * 70, top: 220 }))
  ];

  it("goes along with left and right, across the rows", () => {
    expect(gridStep("ArrowRight", boxes, 4)).toBe(5);
    expect(gridStep("ArrowRight", boxes, 6)).toBe(7);
    expect(gridStep("ArrowLeft", boxes, 7)).toBe(6);
    expect(gridStep("ArrowLeft", boxes, 0)).toBeNull();
    expect(gridStep("ArrowRight", boxes, 9)).toBeNull();
    expect(gridStep("Home", boxes, 6)).toBe(0);
    expect(gridStep("End", boxes, 2)).toBe(9);
  });

  it("goes up and down to the nearest thing in the next line", () => {
    expect(lineStep(boxes, 1, true)).toBe(6);
    // Nothing straight below: the nearest across.
    expect(lineStep(boxes, 4, true)).toBe(6);
    expect(lineStep(boxes, 6, true)).toBe(8);
    expect(lineStep(boxes, 9, false)).toBe(6);
    expect(lineStep(boxes, 5, false)).toBe(0);
    expect(lineStep(boxes, 2, false)).toBeNull();
    expect(lineStep(boxes, 8, true)).toBeNull();
    expect(gridStep("ArrowDown", boxes, 0)).toBe(5);
    expect(gridStep("ArrowUp", boxes, 7)).toBe(5);
  });

  it("leaves other keys alone", () => {
    expect(isGridKey("Tab")).toBe(false);
    expect(isGridKey("Enter")).toBe(false);
    expect(isGridKey("ArrowDown")).toBe(true);
    expect(gridStep("a", boxes, 3)).toBeNull();
    expect(lineStep(boxes, 99, true)).toBeNull();
  });
});
