import { describe, expect, it } from "vitest";
import * as pip from "./index";
import { freeSpot, fridgeBox, houseItems, houseLevels, levelDecor, levelFixtures, registerHouseArt, withLevelDecor, type HouseLevel } from "./home.js";
import { catalogue } from "./shop";
import {
  FRIDGE_LINGER_S,
  FRIDGE_OPEN_S,
  KINDS,
  MAGNETS,
  NOTE_BOOKS,
  fridgeFetch,
  fridgeHope,
  fridgeNothing,
  fridgeShutOnHer,
  fridgeShutsAt,
  fridgeStand,
  kindOf,
  noteBooks,
  noteWords,
  notesWords,
  opensCard,
  parseRemembered,
  pinnedNotes,
  type Notable
} from "./furnish";
import { seeded } from "./behaviour";

registerHouseArt(pip as unknown as Record<string, unknown>);

const level = (id: string) => houseLevels().find((entry) => entry.id === id) as HouseLevel;
const bedroom = () => level("bedroom");

describe("where the fridge stands", () => {
  it("takes the first place that is free, and the least crowded when none is", () => {
    expect(freeSpot([169, 115, 63], 12, [])).toBe(169);
    expect(freeSpot([169, 115, 63], 12, [{ x: 150, w: 25 }])).toBe(115);
    expect(freeSpot([169, 115, 63], 12, [{ x: 150, w: 25 }, { x: 100, w: 20 }])).toBe(63);
    // All three crowded: the one overlapped least, the earlier of two as bad.
    expect(freeSpot([169, 115, 63], 12, [{ x: 150, w: 25 }, { x: 100, w: 20 }, { x: 60, w: 5 }])).toBe(63);
    expect(freeSpot([169, 115], 12, [{ x: 160, w: 12 }, { x: 110, w: 8 }])).toBe(169);
    expect(freeSpot([], 12, [])).toBeNull();
  });

  it("is in the bedroom of a new house, on the floor, clear of the bed", () => {
    const room = bedroom();
    const box = fridgeBox(room, levelDecor({}, room));
    expect(box).toEqual({ x: 169, y: 92, w: 12, h: 20 });
    // (The floor's other fixture, the bookcase, comes after it: bookSpines.test.ts.)
    expect(levelFixtures(room, levelDecor({}, room))[0]).toEqual({ itemId: "minifridge", x: 169, y: 92 });
    expect(levelFixtures(room, levelDecor({}, room), true)[0]).toEqual({ itemId: "minifridge-open", x: 169, y: 92 });
  });

  it("is in a house saved before there was one, and the saved layout is as it was", () => {
    const room = bedroom();
    const saved = { "bedroom/floor-1": "bed", "bedroom/floor-3": "armchair", "bedroom/wall-1": "poster", "bedroom/@wallpaper": "cream" };
    const decor = levelDecor(saved, room);
    // Nothing of the fridge in what is placed, or in what would be saved again.
    expect(decor.placed.map((entry) => entry.itemId).sort()).toEqual(["armchair", "bed", "poster"]);
    expect(withLevelDecor(saved, room, decor)).toEqual(saved);
    expect(fridgeBox(room, decor)?.x).toBe(169);
  });

  it("stands aside for a wide piece put where it was, and overlaps nothing while there is room", () => {
    const room = bedroom();
    // The bed is wider than the third floor spot: it reaches into the fridge's first place.
    const wide = levelDecor({ "bedroom/floor-3": "bed", "bedroom/floor-4": "piano" }, room);
    expect(fridgeBox(room, wide)?.x).toBe(115);
    // Crowded everywhere (two pixels of the bed either way): back to its first place, the least in the way.
    const wider = levelDecor({ "bedroom/floor-2": "piano", "bedroom/floor-3": "bed", "bedroom/floor-4": "piano" }, room);
    expect(fridgeBox(room, wider)?.x).toBe(169);
    const lamps = levelDecor({ "bedroom/floor-2": "lamp", "bedroom/floor-3": "bed", "bedroom/floor-4": "lamp" }, room);
    expect(fridgeBox(room, lamps)?.x).toBe(115);
    // Things on the wall and the shelf are never in its way.
    const walls = levelDecor({ "bedroom/wall-2": "poster", "bedroom/top-1": "bookstack", "bedroom/rug-1": "rug" }, room);
    expect(fridgeBox(room, walls)?.x).toBe(169);
  });

  it("is only in the bedroom", () => {
    for (const floor of houseLevels()) {
      const box = fridgeBox(floor, levelDecor({}, floor));
      if (floor.id === "bedroom") expect(box).not.toBeNull();
      else expect(box).toBeNull();
    }
  });

  it("is not decor: not in the shop, the catalogue or any slot", () => {
    expect(houseItems().some((item) => item.id === "minifridge" || item.id === "minifridge-open")).toBe(false);
    expect(catalogue().some((item) => item.id === "minifridge" || item.id === "minifridge-open")).toBe(false);
    // (The floor's other fixtures come after: bookSpines.test.ts, roomThings.test.ts.)
    expect(pip.FIXTURES.map((item) => item.id).slice(0, 3)).toEqual(["minifridge", "minifridge-open", "phoneglow"]);
  });
});

describe("the fridge under the hand", () => {
  it("is a furnishing with a label and a key, and remembers nothing", () => {
    expect(kindOf("minifridge")).toBe("fridge");
    // The Kitchen's Retro Fridge is plain decor.
    expect(kindOf("fridge")).toBeNull();
    expect(KINDS.fridge.keys).toMatch(/Enter/);
    expect(KINDS.fridge.remembers).toEqual([]);
    expect(parseRemembered(JSON.stringify({ "bedroom/fixture:minifridge": { open: true, closed: 1 } }))).toEqual({});
  });

  it("shuts itself a few seconds after the reader opens it", () => {
    expect(fridgeShutsAt(100, null, false)).toBe(100 + FRIDGE_OPEN_S);
    expect(FRIDGE_OPEN_S).toBeGreaterThanOrEqual(4);
    expect(FRIDGE_OPEN_S).toBeLessThanOrEqual(12);
  });

  it("waits for Pip to have her look, and stays open while she holds it", () => {
    // She got there with a second to spare: it does not shut in her face.
    expect(fridgeShutsAt(100, 100 + FRIDGE_OPEN_S - 1, false)).toBe(100 + FRIDGE_OPEN_S - 1 + FRIDGE_LINGER_S);
    // She was beside it already: no longer than it would have been open anyway.
    expect(fridgeShutsAt(100, 100.5, false)).toBe(100 + FRIDGE_OPEN_S);
    expect(fridgeShutsAt(100, null, true)).toBe(Infinity);
  });

  it("has Pip stand at the handle, turned to it, and never in a wall", () => {
    expect(fridgeStand({ x: 169, w: 12 }, 240)).toEqual({ x: 159, face: 1 });
    expect(fridgeStand({ x: 63, w: 12 }, 240)).toEqual({ x: 53, face: 1 });
    const cornered = fridgeStand({ x: 4, w: 12 }, 240);
    expect(cornered.face).toBe(-1);
    expect(cornered.x).toBeGreaterThan(16);
    for (const x of bedroom().fridgeAt) expect(fridgeStand({ x, w: 12 }, 240).face).toBe(1);
  });

  it("gives Pip a few things to say, each short and in her own lower case", () => {
    for (const lines of [fridgeHope, fridgeShutOnHer, fridgeFetch, fridgeNothing]) {
      const rand = seeded(4);
      const said = new Set<string>();
      for (let index = 0; index < 60; index += 1) {
        const reaction = lines(rand);
        expect(reaction.line).toBeTruthy();
        expect(reaction.line).toBe(reaction.line?.toLowerCase());
        expect(reaction.line?.length).toBeLessThanOrEqual(44);
        expect(reaction.loops).toBeGreaterThanOrEqual(1);
        said.add(reaction.line as string);
      }
      expect(said.size).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the notes on the fridge door", () => {
  const note = (id: string, bookId: string, createdAt: string, extra: Partial<Notable> = {}): Notable => ({ id, bookId, kind: "highlight", cfi: `epubcfi(/6/4!/4/${id})`, text: `words of ${id}`, chapter: "Chapter One", color: "yellow", createdAt, ...extra });

  it("are the latest highlights, the newest first, and none with no highlight", () => {
    expect(pinnedNotes([])).toEqual([]);
    const one = pinnedNotes([note("h1", "a", "2026-09-01T10:00:00Z")]);
    expect(one).toEqual([{ id: "h1", bookId: "a", cfi: "epubcfi(/6/4!/4/h1)", text: "words of h1", chapter: "Chapter One", color: "yellow", createdAt: "2026-09-01T10:00:00Z" }]);
    const four = pinnedNotes([note("h1", "a", "2026-09-01T10:00:00Z"), note("h2", "a", "2026-09-04T10:00:00Z"), note("h3", "a", "2026-09-02T10:00:00Z"), note("h4", "a", "2026-09-03T10:00:00Z")]);
    expect(four.map((entry) => entry.id)).toEqual(["h2", "h4", "h3"]);
    expect(MAGNETS).toBe(3);
  });

  it("come from different books while there are books to go round", () => {
    const many = [
      note("a1", "a", "2026-09-10T10:00:00Z"),
      note("a2", "a", "2026-09-09T10:00:00Z"),
      note("a3", "a", "2026-09-08T10:00:00Z"),
      note("b1", "b", "2026-09-05T10:00:00Z"),
      note("c1", "c", "2026-08-01T10:00:00Z"),
      note("d1", "d", "2026-07-01T10:00:00Z")
    ];
    // One from each of the three books highlighted last, not three from the newest.
    expect(pinnedNotes(many).map((entry) => entry.id)).toEqual(["a1", "b1", "c1"]);
    // Two books: the latest of each, then the next latest there is.
    expect(pinnedNotes(many.filter((entry) => entry.bookId === "a" || entry.bookId === "b")).map((entry) => entry.id)).toEqual(["a1", "a2", "b1"]);
    expect(pinnedNotes(many, 1).map((entry) => entry.id)).toEqual(["a1"]);
  });

  it("pass over bookmarks, the character sheets' rows, removed highlights and ones with no words", () => {
    const mixed = [
      note("p1", "a", "2026-09-30T10:00:00Z", { kind: "person" }),
      note("p2", "a", "2026-09-29T10:00:00Z", { kind: "personNote" }),
      note("m1", "a", "2026-09-28T10:00:00Z", { kind: "bookmark", text: null }),
      note("x1", "a", "2026-09-27T10:00:00Z", { deletedAt: "2026-09-28T00:00:00Z" }),
      note("e1", "a", "2026-09-26T10:00:00Z", { text: "   " }),
      note("h1", "a", "2026-09-01T10:00:00Z", { text: "  the  real\n one ", chapter: " Chapter\n Two " })
    ];
    expect(pinnedNotes(mixed)).toEqual([{ id: "h1", bookId: "a", cfi: "epubcfi(/6/4!/4/h1)", text: "the real one", chapter: "Chapter Two", color: "yellow", createdAt: "2026-09-01T10:00:00Z" }]);
  });

  it("read only the few books last open that have highlights", () => {
    const books = Array.from({ length: 16 }, (_, i) => ({ id: `b${i}`, lastOpened: i === 15 ? null : `2026-09-${String(10 + i).padStart(2, "0")}T10:00:00Z` }));
    const counts = Object.fromEntries(books.filter((_, i) => i % 2 === 1).map((entry) => [entry.id, 3]));
    // Odd ones have highlights: the newest opened first, and no more than a handful (the one never opened would be last).
    expect(noteBooks(books, counts).map((entry) => entry.id)).toEqual(["b13", "b11", "b9", "b7", "b5", "b3"]);
    expect(noteBooks(books, counts)).toHaveLength(NOTE_BOOKS);
    expect(noteBooks(books, counts, 99).map((entry) => entry.id).pop()).toBe("b15");
    expect(noteBooks(books, {})).toEqual([]);
    expect(noteBooks(books, { b0: 0 })).toEqual([]);
  });

  it("show a long highlight's start, cut at a word, and a short one whole", () => {
    expect(noteWords("short and sweet")).toBe("short and sweet");
    const long = "word ".repeat(100).trim();
    const cut = noteWords(long, 42);
    expect(cut.length).toBeLessThanOrEqual(43);
    expect(cut.endsWith("word…")).toBe(true);
  });

  it("are a thing of their own on the door: a label, a key, a card, and nothing remembered", () => {
    expect(kindOf("fridgenotes")).toBe("notes");
    expect(KINDS.notes.keys).toMatch(/Enter/);
    expect(KINDS.notes.remembers).toEqual([]);
    expect(opensCard("notes")).toBe(true);
    expect(notesWords(1)).toBe("your latest highlight");
    expect(notesWords(3)).toBe("your 3 latest highlights");
  });

  it("are drawn on the lower door, each on its own paper under a magnet, and leave the freezer door alone", () => {
    const fridge = pip.FIXTURES.find((item) => item.id === "minifridge") as unknown as { w: number; h: number; draw: (g: unknown, f: number, data?: unknown) => void };
    type Painted = { get: (x: number, y: number) => string | null };
    const paint = (data?: unknown) => {
      const g = new pip.Painter(fridge.w, fridge.h, 0) as unknown as Painted;
      fridge.draw(g, 0, data);
      return g;
    };
    const pixels = (g: Painted) => Array.from({ length: fridge.w * fridge.h }, (_, i) => g.get(i % fridge.w, Math.floor(i / fridge.w)));
    const count = (g: Painted, colour: string) => pixels(g).filter((c) => c?.toLowerCase() === colour).length;
    const papers = ["#f4c542", "#7cc46a", "#6aa8e8"];
    const bare = paint({ notes: [] });
    const full = paint({ notes: papers });
    // No highlight: no note, only a magnet waiting for one. The same with nothing said at all (a thumbnail of the floor).
    for (const paper of papers) expect(count(bare, paper)).toBe(0);
    expect(bare.get(7, 9)?.toLowerCase()).toBe("#e0584e");
    expect(pixels(paint())).toEqual(pixels(bare));
    // Three: each paper there (3 x 3, less its magnet and its line of writing), all inside the lower door.
    expect(pip.FRIDGE_NOTES).toHaveLength(MAGNETS);
    for (const [index, paper] of papers.entries()) {
      expect(count(full, paper)).toBe(6);
      const [x, y, magnet] = pip.FRIDGE_NOTES[index];
      expect(full.get(x + 1, y)?.toLowerCase()).toBe(magnet.toLowerCase());
      expect(x).toBeGreaterThanOrEqual(pip.FRIDGE_DOOR.x);
      expect(x + 3).toBeLessThanOrEqual(pip.FRIDGE_DOOR.x + pip.FRIDGE_DOOR.w);
      expect(y).toBeGreaterThanOrEqual(pip.FRIDGE_DOOR.y);
      expect(y + 3).toBeLessThanOrEqual(pip.FRIDGE_DOOR.y + pip.FRIDGE_DOOR.h);
    }
    // No two notes touch, and the freezer door above them is as it was.
    const boxes = pip.FRIDGE_NOTES.map(([x, y]) => ({ x, y }));
    for (const a of boxes) for (const b of boxes) if (a !== b) expect(Math.abs(a.x - b.x) >= 4 || Math.abs(a.y - b.y) >= 4).toBe(true);
    for (let y = 0; y < pip.FRIDGE_DOOR.y; y += 1) for (let x = 0; x < 12; x += 1) expect(full.get(x, y)).toBe(bare.get(x, y));
    // The notes leave the fridge a part of its own to be opened by: the freezer door.
    expect(pip.FRIDGE_DOOR.y).toBeGreaterThanOrEqual(6);
    // A fourth has nowhere to go: three are drawn.
    expect(count(paint({ notes: [...papers, "#ec8fb4"] }), "#ec8fb4")).toBe(0);
  });
});
