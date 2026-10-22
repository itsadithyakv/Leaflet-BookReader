import { describe, expect, it } from "vitest";
import { chapterBrings, volumeSays } from "./chapters";
import { RING_AT, RING_PLACES, STONE_SETS, ringSpot, stoneSays, stonesOf } from "./stones";
import { BUD_AT, PATH_BLOOMS, WILD_MOST, bloomPlaces, bloomsOf, budStage, pathSpots, trophyKind, wildSpot } from "./trophies";
import { trophyKey } from "./rules";

const H = 60;

describe("the Reading Stones", () => {
  it("stand one a chapter from the seventh, then one a volume, carved with the hours", () => {
    expect(stonesOf(20 * H).stones).toEqual([]);
    expect(stonesOf(21 * H).stones.map((stone) => stone.carved)).toEqual([7]);
    expect(stonesOf(45 * H).stones.map((stone) => stone.carved)).toEqual([7, 8, 9, 10]);
    const sixty = stonesOf(60 * H);
    expect(sixty.stones.filter((stone) => stone.tall).map((stone) => [stone.volume, stone.carved])).toEqual([[1, 60]]);
    expect(sixty.sets).toEqual([1]);
    expect(STONE_SETS[0]).toBe("Lanterns");
  });

  it("fill the ring at 165 hours, and go round again after, the latest in each place", () => {
    const full = stonesOf(165 * H);
    expect(full.stones).toHaveLength(RING_PLACES);
    expect(new Set(full.stones.map((stone) => stone.place)).size).toBe(RING_PLACES);
    expect(full.stones.every((stone) => stone.round === 1)).toBe(true);
    const again = stonesOf(180 * H);
    expect(again.stones).toHaveLength(RING_PLACES);
    const first = again.stones.find((stone) => stone.place === 4)!;
    expect(first).toMatchObject({ volume: 9, carved: 180, round: 2 });
    expect(again.stones.find((stone) => stone.place === 5)!.round).toBe(1);
    // The sets stop at six.
    expect(stonesOf(400 * H).sets).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stonesOf(400 * H).stones.find((stone) => stone.place === 4)!.round).toBeGreaterThanOrEqual(3);
  });

  it("stand round the ring at the back of the meadow on whole pixels, none in front of another, clear of the bud", () => {
    const spots = Array.from({ length: RING_PLACES }, (_, place) => ringSpot(place));
    for (const [x, y] of spots) {
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      expect(x - 5).toBeGreaterThanOrEqual(0);
      expect(x + 5).toBeLessThan(240);
      expect(y).toBeLessThanOrEqual(102);
      // Clear of the bud at the Reading Path's end, and of Pip in stone in the middle.
      expect(Math.abs(x - BUD_AT[0]) >= 7 || Math.abs(y - BUD_AT[1]) >= 12).toBe(true);
      expect(Math.abs(x - RING_AT[0]) >= 8 || Math.abs(y - RING_AT[1]) >= 12).toBe(true);
    }
    // A tall stone is about 8 pixels wide and 12 high at the meadow's size: no two overlap.
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) {
        const [ax, ay] = spots[a];
        const [bx, by] = spots[b];
        expect(Math.abs(ax - bx) >= 8 || Math.abs(ay - by) >= 13, `places ${a} and ${b}`).toBe(true);
      }
    }
  });

  it("say what they are, and a volume says its stone and its set", () => {
    expect(stoneSays({ tall: true, carved: 90, volume: 3 })).toBe("Volume 3 · 90 h read");
    expect(stoneSays({ tall: false, carved: 8, volume: null })).toBe("Chapter 8");
    expect(volumeSays(1)).toBe("A standing stone with your hours carved on it, and Pip sets out lanterns by the stones");
    expect(volumeSays(7)).toBe("A standing stone with your hours carved on it");
    expect(chapterBrings(12).says).toBe(volumeSays(2));
  });
});

describe("the blooms on the Reading Path", () => {
  const book = (id: string, genres: string[] = []) => ({ id, title: `Book ${id}`, author: "An Author", genres, finishedAt: "2026-10-01" });

  it("are the trophies raised, in order, each by its book's kind; a book gone from the library is a pagewort", () => {
    const books = [book("a", ["Fantasy"]), book("b", ["Mystery"])];
    const blooms = bloomsOf([trophyKey("b"), trophyKey("gone"), trophyKey("a")], books);
    expect(blooms.map((entry) => entry.kind)).toEqual([trophyKind(["Mystery"]), 0, trophyKind(["Fantasy"])]);
    expect(blooms[1]).toMatchObject({ title: null, kind: 0 });
    expect(blooms[0].title).toBe("Book b");
  });

  it("put the newest nearest the stones, 48 along the path, the rest wild, a hundred at most", () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ kind: index % 11 }));
    const laid = bloomPlaces(many);
    expect(laid.path).toHaveLength(PATH_BLOOMS);
    expect(laid.path[0].bloom).toBe(199);
    expect(laid.wild).toHaveLength(WILD_MOST);
    expect(laid.older).toBe(200 - PATH_BLOOMS);
    const spots = pathSpots();
    expect(spots).toHaveLength(48);
    // The first nearest the bud (and the stones), and every one in the meadow, above the keys at its foot.
    expect(Math.hypot(spots[0][0] - BUD_AT[0], spots[0][1] - BUD_AT[1])).toBeLessThan(12);
    for (const [x, y] of spots) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(240);
      expect(y).toBeLessThanOrEqual(102);
    }
    for (let slot = 0; slot < WILD_MOST; slot++) {
      const [x, y] = wildSpot(slot);
      expect(x).toBeGreaterThanOrEqual(8);
      expect(x).toBeLessThanOrEqual(161);
      expect([57, 61]).toContain(y);
    }
    expect(bloomPlaces([]).path).toEqual([]);
  });

  it("have a bud for the next one, by the reading behind no trophy yet", () => {
    expect([0, 29, 30, 59, 60, 89, 90, 500].map(budStage)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});
