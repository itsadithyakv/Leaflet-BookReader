import { afterEach, describe, expect, it, vi } from "vitest";
import * as pip from "./index";
import { fixtureBoxes, freePlace, houseItems, houseLevels, levelDecor, levelFixtures, registerHouseArt, withLevelDecor, type HouseLevel } from "./home.js";
import { catalogue } from "./shop";
import { KINDS, kindOf, opensCard } from "./furnish";
import {
  RIBBON_STEPS,
  ROW_BOOKS,
  SHELVES,
  SPINE_PALETTE,
  SPINE_STORE,
  STACKS,
  STACK_BOOKS,
  bookcaseArt,
  coverKey,
  currentBook,
  dominantColour,
  fallbackColour,
  finishedAt,
  finishedBooks,
  keptColour,
  legible,
  parseSpines,
  revOf,
  ribbonStep,
  shelfPlan,
  shelfWords,
  shownBooks,
  spineColour,
  spineTall,
  withSpine
} from "./bookSpines";
import { bookInHand, handBook, readingMove, setHandBook } from "./furnish-art.js";
import { forgetBooksOnThisDevice } from "../services/deviceData";

registerHouseArt(pip as unknown as Record<string, unknown>);

const bedroom = () => houseLevels().find((entry) => entry.id === "bedroom") as HouseLevel;

const book = (id: string, progress: number, lastOpened: string | null, extra: Partial<{ title: string; coverUrl: string | null; createdAt: string; progressUpdatedAt: string | null }> = {}) => ({
  id,
  title: extra.title ?? `Book ${id}`,
  progress,
  lastOpened,
  createdAt: extra.createdAt ?? "2026-01-01T00:00:00Z",
  coverUrl: extra.coverUrl ?? null,
  progressUpdatedAt: extra.progressUpdatedAt
});

/** A cover of flat colours: `[colour, share]` pairs, as RGBA bytes. */
const cover = (...parts: Array<[string, number]>) => {
  const out: number[] = [];
  for (const [hex, count] of parts) {
    const n = Number.parseInt(hex.slice(1), 16);
    for (let i = 0; i < count; i += 1) out.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255);
  }
  return out;
};
const rgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
const lightness = (hex: string) => (Math.max(...rgb(hex)) + Math.min(...rgb(hex))) / 510;

describe("which books are on her shelf", () => {
  const library = [
    book("a", 1, "2026-03-01T10:00:00Z", { title: "Alpha" }),
    book("b", 0.995, "2026-09-01T10:00:00Z", { title: "Beta" }),
    book("c", 0.5, "2026-10-01T10:00:00Z", { title: "Gamma" }),
    book("d", 0.98, "2026-08-01T10:00:00Z", { title: "Delta" }),
    book("e", 0.99, null, { title: "Epsilon", createdAt: "2026-05-01T00:00:00Z" }),
    book("f", 0, null, { title: "Zeta" })
  ];

  it("has every finished book, by the library's own rule, the most recently finished first", () => {
    // 0.99 is finished (the last page of an EPUB reports that); 0.98 is not.
    expect(finishedBooks(library).map((entry) => entry.id)).toEqual(["b", "e", "a"]);
    expect(finishedBooks([])).toEqual([]);
  });

  it("goes by when each was finished (when its progress last moved), not when it was last opened", () => {
    const shelf = [
      // Finished in March, opened again yesterday to look something up: it does not jump the queue.
      book("old", 1, "2026-10-03T10:00:00Z", { progressUpdatedAt: "2026-03-01T10:00:00Z" }),
      book("new", 1, "2026-09-01T10:00:00Z", { progressUpdatedAt: "2026-09-01T10:30:00Z" }),
      // From before the library kept that: when it was last open is all there is.
      book("legacy", 1, "2026-06-01T10:00:00Z"),
      book("null", 1, "2026-05-01T10:00:00Z", { progressUpdatedAt: null })
    ];
    expect(finishedBooks(shelf).map((entry) => entry.id)).toEqual(["new", "legacy", "null", "old"]);
    expect(finishedAt(shelf[0])).toBe(Date.parse("2026-03-01T10:00:00Z"));
    expect(finishedAt(shelf[2])).toBe(Date.parse("2026-06-01T10:00:00Z"));
    // Written with an offset or without, a moment is a moment.
    const mixed = [book("a", 1, null, { progressUpdatedAt: "2026-09-01T12:00:00+05:30" }), book("b", 1, null, { progressUpdatedAt: "2026-09-01T07:00:00Z" })];
    expect(finishedBooks(mixed).map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("orders books opened at the same moment by title, so the shelf never shuffles", () => {
    const same = [book("y", 1, "2026-01-01T00:00:00Z", { title: "Book 10" }), book("x", 1, "2026-01-01T00:00:00Z", { title: "Book 9" })];
    expect(finishedBooks(same).map((entry) => entry.id)).toEqual(["x", "y"]);
    expect(finishedBooks([...same].reverse()).map((entry) => entry.id)).toEqual(["x", "y"]);
  });

  it("puts the book being read in her hands: the one last opened that is not finished", () => {
    expect(currentBook(library)?.id).toBe("c");
    // Only finished books, or none ever opened: no book of the reader's to hold.
    expect(currentBook(library.filter((entry) => entry.progress >= 0.99))).toBeNull();
    expect(currentBook([book("f", 0, null)])).toBeNull();
  });

  it("says how many there are", () => {
    expect(shelfWords(0)).toBe("no finished books yet");
    expect(shelfWords(1)).toBe("1 finished book");
    expect(shelfWords(40)).toBe("40 finished books");
  });
});

describe("a cover's colour", () => {
  it("is the dominant one, not the muddy average", () => {
    // Navy with gold lettering: navy, where the mean of the two is a grey-brown.
    const colour = dominantColour(cover(["#1E2A6E", 300], ["#E8C040", 84])) as string;
    const [r, g, b] = rgb(colour);
    expect(b).toBeGreaterThan(r + 40);
    expect(b).toBeGreaterThan(g + 40);
    expect(colour.toLowerCase()).toBe("#1e2a6e");
  });

  it("is the colour of a white page's title, not the white", () => {
    const colour = dominantColour(cover(["#FFFFFF", 300], ["#C8202C", 84])) as string;
    const [r, g, b] = rgb(colour);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
  });

  it("gathers the shades of one hue, as a photograph has them", () => {
    // Forty greens, none twice, and a block of one grey: green wins.
    const greens: Array<[string, number]> = Array.from({ length: 40 }, (_, i) => [`#${(30 + i).toString(16)}${(120 + i * 2).toString(16)}${(50 + i).toString(16)}`, 5]);
    const [r, g, b] = rgb(dominantColour(cover(...greens, ["#808080", 120])) as string);
    expect(g).toBeGreaterThan(r + 40);
    expect(g).toBeGreaterThan(b + 40);
  });

  it("is a grey for a cover with no colour in it, and nothing for no cover", () => {
    const [r, g, b] = rgb(dominantColour(cover(["#202020", 200], ["#F0F0F0", 100])) as string);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(8);
    expect(dominantColour([])).toBeNull();
    // See-through pixels are not the cover.
    expect(dominantColour([255, 0, 0, 0, 255, 0, 0, 10])).toBeNull();
  });

  it("is made legible: never nearly black or nearly white, its hue kept", () => {
    for (const hex of ["#000000", "#05070F", "#FFFFFF", "#FDF8E8", "#1E2A6E", "#C8202C", "#7CC46A", "#0A0000"]) {
      const out = legible(hex);
      expect(out).toMatch(/^#[0-9a-f]{6}$/);
      expect(lightness(out)).toBeGreaterThanOrEqual(0.29);
      expect(lightness(out)).toBeLessThanOrEqual(0.73);
    }
    // A colour already in range is left alone.
    expect(legible("#c8453b")).toBe("#c8453b");
    // Navy lightened is still blue; a black with a breath of red in it is a dark grey, not scarlet.
    const navy = rgb(legible("#101A4E"));
    expect(navy[2]).toBeGreaterThan(navy[0] + 40);
    const black = rgb(legible("#0A0000"));
    expect(black[0] - black[2]).toBeLessThan(40);
  });

  it("falls back to a colour from the book's id: always the same, always one of the house's own", () => {
    expect(fallbackColour("book-1")).toBe(fallbackColour("book-1"));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => fallbackColour(`book-${i}`)));
    expect(seen.size).toBeGreaterThanOrEqual(8);
    for (const colour of seen) {
      expect(SPINE_PALETTE).toContain(colour);
      expect(lightness(colour)).toBeGreaterThan(0.25);
      expect(lightness(colour)).toBeLessThan(0.85);
    }
    for (let i = 0; i < 50; i += 1) {
      expect(spineTall(`book-${i}`)).toBeGreaterThanOrEqual(6);
      expect(spineTall(`book-${i}`)).toBeLessThanOrEqual(8);
    }
  });
});

describe("the colours kept on this device", () => {
  const withCover = { id: "a", coverUrl: "covers/a.jpg" };

  it("keeps a cover's colour per book, and reads it back", () => {
    const kept = withSpine({}, withCover, "#1E2A6E", new Set(["a"]));
    expect(keptColour(kept, withCover)).toBe(legible("#1E2A6E"));
    expect(spineColour(kept, withCover)).toBe(legible("#1E2A6E"));
    expect(parseSpines(JSON.stringify(kept))).toEqual(kept);
  });

  it("uses the fallback until a cover has been read, and for a book with none", () => {
    expect(spineColour({}, withCover)).toBe(fallbackColour("a"));
    expect(spineColour({ b: ["#123456", ""] }, { id: "b", coverUrl: null })).toBe(fallbackColour("b"));
  });

  it("reads a new cover again", () => {
    const kept = withSpine({}, withCover, "#1E2A6E", new Set(["a"]));
    expect(keptColour(kept, { id: "a", coverUrl: "covers/a-2.jpg" })).toBeNull();
    expect(coverKey({ coverUrl: null })).toBe("");
  });

  it("forgets books that have left the library, and anything it does not understand", () => {
    const kept = withSpine({ gone: ["#123456", "k"], here: ["#654321", "k"] }, withCover, "#1E2A6E", new Set(["a", "here"]));
    expect(Object.keys(kept).sort()).toEqual(["a", "here"]);
    expect(parseSpines("not json")).toEqual({});
    expect(parseSpines(null)).toEqual({});
    expect(parseSpines(JSON.stringify({ a: ["red", "k"], b: "#123456", c: ["#12345", "k"], d: ["#ABCDEF", "k"], e: [] }))).toEqual({ d: ["#ABCDEF", "k"] });
  });

  describe("and Delete All Data", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("removes them with the other lists of book ids", () => {
      const data = new Map<string, string>([[SPINE_STORE, '{"a":["#123456","k"]}'], ["leaflet.pip.furnish", "{}"]]);
      vi.stubGlobal("localStorage", {
        get length() {
          return data.size;
        },
        key: (index: number) => [...data.keys()][index] ?? null,
        getItem: (key: string) => data.get(key) ?? null,
        removeItem: (key: string) => void data.delete(key)
      });
      expect(forgetBooksOnThisDevice()).toBe(1);
      expect([...data.keys()]).toEqual(["leaflet.pip.furnish"]);
    });
  });
});

describe("how the bookcase holds them", () => {
  const standing = (n: number) => shelfPlan(n).shelves.map((shelf) => ("standing" in shelf ? shelf.standing.length : null));
  const stacked = (n: number) => shelfPlan(n).shelves.map((shelf) => ("stacks" in shelf ? shelf.stacks.map((pile) => pile.length) : null));
  const every = (n: number) => shelfPlan(n).shelves.flatMap((shelf) => ("standing" in shelf ? shelf.standing : shelf.stacks.flat()));

  it("is four empty shelves with no books", () => {
    expect(shelfPlan(0)).toEqual({ shelves: [{ standing: [] }, { standing: [] }, { standing: [] }, { standing: [] }], shown: 0, count: null });
  });

  it("stands one, and seven, on the top shelf, the most recent first", () => {
    expect(standing(1)).toEqual([1, 0, 0, 0]);
    expect(standing(7)).toEqual([7, 0, 0, 0]);
    expect(every(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("stands forty in rows, with room to spare", () => {
    expect(standing(40)).toEqual([11, 11, 11, 7]);
    expect(shelfPlan(40).count).toBeNull();
    expect(standing(SHELVES * ROW_BOOKS)).toEqual([11, 11, 11, 11]);
  });

  it("gives the lowest shelves over to stacks when rows no longer hold them, the oldest in the stacks", () => {
    expect(standing(45)).toEqual([11, 11, 11, null]);
    expect(stacked(45)).toEqual([null, null, null, [8, 4]]);
    expect(stacked(60)).toEqual([null, null, [8, 8, 8], [8, 6]]);
    expect(standing(83)).toEqual([11, null, null, null]);
    expect(stacked(83)).toEqual([null, [8, 8, 8], [8, 8, 8], [8, 8, 8]]);
    expect(shelfPlan(83)).toMatchObject({ shown: 83, count: null });
    // Every book once, in order, top shelf to bottom.
    for (const n of [0, 1, 7, 40, 44, 45, 57, 58, 70, 83]) expect(every(n)).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it("shows the newest and says how many there are in all, past what it holds", () => {
    const plan = shelfPlan(400);
    expect(plan.count).toBe(400);
    expect(plan.shown).toBe(ROW_BOOKS + 3 * STACKS * STACK_BOOKS);
    expect(every(400)).toEqual(Array.from({ length: 83 }, (_, i) => i));
    expect(shelfPlan(84).count).toBe(84);
    expect(shownBooks(400)).toBe(83);
    expect(shownBooks(7)).toBe(7);
  });

  it("never loses or doubles a book, and never overfills a shelf, whatever the number", () => {
    for (let n = 0; n <= 420; n += 1) {
      const plan = shelfPlan(n);
      expect(plan.shelves).toHaveLength(SHELVES);
      expect(every(n)).toEqual(Array.from({ length: plan.shown }, (_, i) => i));
      expect(plan.shown).toBe(Math.min(n, 83));
      expect(plan.count).toBe(n > 83 ? n : null);
      for (const shelf of plan.shelves) {
        if ("standing" in shelf) expect(shelf.standing.length).toBeLessThanOrEqual(ROW_BOOKS);
        else {
          expect(shelf.stacks.length).toBeLessThanOrEqual(STACKS);
          for (const pile of shelf.stacks) expect(pile.length).toBeLessThanOrEqual(STACK_BOOKS);
        }
      }
      // The top shelf is always her latest reads, standing.
      expect("standing" in plan.shelves[0]).toBe(true);
    }
  });

  it("hands the art each book's colour, and a name that changes only when the picture would", () => {
    const books = Array.from({ length: 50 }, (_, i) => ({ id: `b${i}`, coverUrl: i === 0 ? "covers/0.jpg" : null }));
    const bare = bookcaseArt(books, {});
    const first = bare.shelves[0];
    expect("standing" in first && first.standing[0]).toEqual([fallbackColour("b0"), spineTall("b0")]);
    expect("stacks" in bare.shelves[3] && bare.shelves[3].stacks[0][0]).toBe(fallbackColour("b33"));
    const kept = withSpine({}, books[0], "#1E2A6E", new Set(books.map((entry) => entry.id)));
    const read = bookcaseArt(books, kept);
    expect("standing" in read.shelves[0] && read.shelves[0].standing[0][0]).toBe(legible("#1E2A6E"));
    expect(revOf(bare)).toBe(revOf(bookcaseArt(books, {})));
    expect(revOf(read)).not.toBe(revOf(bare));
    // A book past the shelves changes nothing on them, but the tag's number.
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `b${i}`, coverUrl: null }));
    expect(bookcaseArt(many, {}).count).toBe(400);
    expect(bookcaseArt(many, {}).shelves).toEqual(bookcaseArt(many.slice(0, 390), {}).shelves);
  });
});

/** A fixture drawn on a painter of its own, to look at its pixels. */
const drawn = (id: string, data?: unknown) => {
  const item = pip.FIXTURES.find((entry) => entry.id === id) as unknown as { w: number; h: number; draw: (g: unknown, f: number, data?: unknown) => void };
  const g = new pip.Painter(item.w, item.h, 0) as unknown as { get: (x: number, y: number) => string | null };
  item.draw(g, 0, data);
  const colours = new Map<string, number>();
  for (let y = 0; y < item.h; y += 1) for (let x = 0; x < item.w; x += 1) {
    const c = g.get(x, y);
    if (c) colours.set(c.toLowerCase(), (colours.get(c.toLowerCase()) ?? 0) + 1);
  }
  return { g, colours, item };
};

describe("the bookcase in the room", () => {
  it("is a fixture of the bedroom, on the wall between the poster and the window, in no slot", () => {
    const room = bedroom();
    const decor = levelDecor({}, room);
    // Its art has room above the case for the tag and the diary; the case itself is what is chosen.
    expect(fixtureBoxes(room, decor).bookcase).toEqual({ x: 62, y: 30, w: 26, h: 52, hit: { x: 62, y: 38, w: 26, h: 44 } });
    // Clear of everything a new room comes with.
    const box = fixtureBoxes(room, decor).bookcase;
    for (const slot of room.slots.filter((entry) => entry.fits === "wall" || entry.fits === "window" || entry.fits === "top")) {
      const apart = slot.x >= box.x + box.w || slot.x + slot.w <= box.x || slot.y >= box.y + box.h || slot.y + slot.h <= box.y;
      expect(apart).toBe(true);
    }
    for (const floor of houseLevels()) if (floor.id !== "bedroom") expect(fixtureBoxes(floor, levelDecor({}, floor))).toEqual({});
  });

  it("is every reader's: not in the shop, the catalogue or a saved layout, and a house saved before it has it", () => {
    expect(houseItems().some((item) => item.id === "bookcase")).toBe(false);
    expect(catalogue().some((item) => item.id === "bookcase")).toBe(false);
    const room = bedroom();
    const saved = { "bedroom/floor-1": "bed", "bedroom/wall-1": "poster" };
    const decor = levelDecor(saved, room);
    expect(withLevelDecor(saved, room, decor)).toEqual(saved);
    expect(levelFixtures(room, decor).map((entry) => entry.itemId)).toContain("bookcase");
    expect(levelFixtures(room, decor, false, { bookcase: { shelves: [], count: null } }).find((entry) => entry.itemId === "bookcase")).toEqual({ itemId: "bookcase", x: 62, y: 30, data: { shelves: [], count: null } });
  });

  it("takes the place its neighbours cover least, like the fridge", () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    expect(freePlace([[0, 0], [20, 0]], 10, 10, [])).toEqual([0, 0]);
    expect(freePlace([[0, 0], [20, 0]], 10, 10, [box])).toEqual([20, 0]);
    // Both covered: the one covered less; a tie goes to the earlier.
    expect(freePlace([[0, 0], [5, 5]], 10, 10, [box])).toEqual([5, 5]);
    expect(freePlace([[0, 0], [20, 0]], 10, 10, [box, { x: 20, y: 0, w: 10, h: 10 }])).toEqual([0, 0]);
    // Beside it but above or below: not in its way.
    expect(freePlace([[0, 0], [20, 0]], 10, 10, [{ x: 0, y: 10, w: 10, h: 10 }])).toEqual([0, 0]);
    expect(freePlace([], 10, 10, [])).toBeNull();
  });

  it("can be chosen, with a label and a key, and opens a card", () => {
    expect(kindOf("bookcase")).toBe("bookcase");
    expect(KINDS.bookcase.keys).toMatch(/Enter/);
    expect(opensCard("bookcase")).toBe(true);
    expect(opensCard("fridge")).toBe(false);
  });

  it("draws each book in its own colour: none, one, seven, forty and four hundred", () => {
    const books = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, coverUrl: null }));
    const marked = (n: number) => {
      const kept = withSpine({}, { id: "b0", coverUrl: "c" }, "#12AB34", new Set(["b0"]));
      const list = books(n).map((entry, i) => (i === 0 ? { ...entry, coverUrl: "c" } : entry));
      return drawn("bookcase", bookcaseArt(list, kept));
    };
    const empty = drawn("bookcase", bookcaseArt([], {}));
    // Empty: the case and nothing in it; and no tag, so nothing drawn above the case.
    for (const colour of SPINE_PALETTE) expect(empty.colours.has(colour.toLowerCase())).toBe(false);
    for (let y = 0; y < pip.BOOKCASE_TAG; y += 1) for (let x = 0; x < 26; x += 1) expect(empty.g.get(x, y)).toBeNull();
    // Drawn with no data at all (a thumbnail of the floor): the same empty case.
    expect([...drawn("bookcase").colours]).toEqual([...empty.colours]);

    // One: its spine, top shelf, far left, as tall as its id says.
    const one = marked(1);
    const tall = spineTall("b0");
    expect(one.colours.get("#12ab34")).toBe(tall - 1);
    expect(one.g.get(2, pip.BOOKCASE_TAG + 2 + 8)).toBe("#12ab34");
    expect(one.g.get(2, pip.BOOKCASE_TAG + 2 + 8 - tall)).not.toBe("#12ab34");

    // Seven and forty: more of the case filled each time, still no tag.
    const filled = (art: ReturnType<typeof drawn>) => [...art.colours].filter(([colour]) => SPINE_PALETTE.some((entry) => entry.toLowerCase() === colour)).reduce((sum, [, count]) => sum + count, 0);
    const seven = marked(7);
    const forty = marked(40);
    expect(filled(seven)).toBeGreaterThan(filled(one));
    expect(filled(forty)).toBeGreaterThan(filled(seven) * 4);
    for (let y = 0; y < pip.BOOKCASE_TAG; y += 1) for (let x = 0; x < 26; x += 1) expect(forty.g.get(x, y)).toBeNull();

    // Four hundred: the newest still on the top shelf, stacks below, and a tag above the case.
    const lots = marked(400);
    expect(lots.g.get(2, pip.BOOKCASE_TAG + 2 + 8)).toBe("#12ab34");
    let tag = 0;
    for (let y = 0; y < pip.BOOKCASE_TAG; y += 1) for (let x = 0; x < 26; x += 1) if (lots.g.get(x, y)) tag += 1;
    expect(tag).toBeGreaterThan(60);
    // A stack's books are a pixel each: the bottom shelf's first column of stripes has eight colours down it.
    const foot = pip.BOOKCASE_TAG + 2 + 3 * 10 + 8;
    for (let j = 0; j < 8; j += 1) expect(SPINE_PALETTE.map((entry) => entry.toLowerCase())).toContain(lots.g.get(4, foot - j)?.toLowerCase());
  });
});

describe("the book in her hands", () => {
  it("puts the ribbon further along the further the reader is", () => {
    expect(ribbonStep(0)).toBe(0);
    expect(ribbonStep(0.5)).toBe(4);
    expect(ribbonStep(0.99)).toBe(RIBBON_STEPS - 1);
    expect(ribbonStep(1)).toBe(RIBBON_STEPS - 1);
    expect(ribbonStep(null)).toBe(0);
    expect(ribbonStep(Number.NaN)).toBe(0);
    for (let p = 0; p < 1; p += 0.01) expect(ribbonStep(p + 0.01)).toBeGreaterThanOrEqual(ribbonStep(p));
  });

  /** The book drawn alone on a 32 x 32 sprite, as a pose holds it. */
  const held = (o: { cover: string; progress?: number }) => {
    const g = new pip.Painter(32, 32, 0) as unknown as { get: (x: number, y: number) => string | null; rect: (x: number, y: number, w: number, h: number, c: string) => unknown };
    bookInHand(g, 16, 18, o);
    const at = (colour: string) => {
      const found: number[] = [];
      for (let x = 0; x < 32; x += 1) if (g.get(x, 25)?.toLowerCase() === colour.toLowerCase()) found.push(x);
      return found;
    };
    return { g, at };
  };

  it("is the cover's colour, with a ribbon below the book at the reader's place", () => {
    const start = held({ cover: "#2F80E6", progress: 0 });
    const end = held({ cover: "#2F80E6", progress: 1 });
    const middle = held({ cover: "#2F80E6", progress: 0.5 });
    // The cover shows along the foot of the book.
    expect(start.g.get(11, 23)?.toLowerCase()).toBe("#2f80e6");
    // The ribbon hangs below the foot, one pixel wide, and moves left to right across the pages.
    expect(start.at("#E0393E")).toEqual([12]);
    expect(middle.at("#E0393E")).toEqual([16]);
    expect(end.at("#E0393E")).toEqual([19]);
    // No progress given: no ribbon (the plain book of the other poses).
    expect(held({ cover: "#2F80E6" }).at("#E0393E")).toEqual([]);
    // Against a red cover the ribbon is gold, so it can be seen.
    expect(held({ cover: "#C8453B", progress: 0.5 }).at("#FFD23F")).toEqual([16]);
  });

  it("is a move of its own for each book and place, and plain reading with no book", () => {
    setHandBook(null);
    expect(readingMove()).toBe("read");
    expect(handBook()).toBeNull();
    setHandBook({ cover: "#2F80E6", progress: 0.4 });
    const id = readingMove();
    expect(id).toBe("read-2f80e6-3");
    const move = pip.LIB.find((entry) => entry.id === id);
    expect(move).toMatchObject({ loop: 48, cat: "" });
    // Asked again, the same move: registered once.
    expect(readingMove()).toBe(id);
    expect(pip.LIB.filter((entry) => entry.id === id)).toHaveLength(1);
    // Further on, or another book: another.
    setHandBook({ cover: "#2F80E6", progress: 0.9 });
    expect(readingMove()).toBe("read-2f80e6-7");
    setHandBook({ cover: "#1FA36A", progress: 0.9 });
    expect(readingMove()).toBe("read-1fa36a-7");
    // Not a colour: the plain book.
    setHandBook({ cover: "blue", progress: 0.9 });
    expect(readingMove()).toBe("read");
    setHandBook(null);
  });
});
