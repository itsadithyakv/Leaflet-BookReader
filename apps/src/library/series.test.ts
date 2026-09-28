import { describe, expect, it } from "vitest";
import type { Book } from "@shared/models/book";
import { authorKey, buildSeries, seriesFromTitle, seriesKey, titleKeys } from "./series";
import { buildShelves, findDuplicates } from "./shelves";

let nextId = 1;
const book = (title: string, author: string | null, extra: Partial<Book> = {}): Book => ({
  id: `b${nextId++}`,
  title,
  author,
  genres: [],
  coverUrl: null,
  localPath: "",
  fileHash: "",
  progress: 0,
  lastOpened: null,
  createdAt: "2026-09-01T00:00:00Z",
  ...extra
});

const HARRY_POTTER = [
  "Harry Potter and the Sorcerer's Stone",
  "Harry Potter and the Chamber of Secrets",
  "Harry Potter and the Prisoner of Azkaban",
  "Harry Potter and the Goblet of Fire",
  "Harry Potter and the Order of the Phoenix",
  "Harry Potter and the Half-Blood Prince",
  "Harry Potter and the Deathly Hallows"
];

describe("buildSeries", () => {
  it("makes all seven Harry Potter books one series, in order, from titles alone", () => {
    // Shuffled, with the author written three ways and one UK title.
    const books = [
      book(HARRY_POTTER[3], "J.K. Rowling"),
      book("Harry Potter and the Philosopher's Stone", "J. K. Rowling"),
      book(HARRY_POTTER[6], "Rowling, J.K."),
      book(HARRY_POTTER[1], "J.K. Rowling"),
      book(HARRY_POTTER[5], "J.K. Rowling"),
      book(HARRY_POTTER[2], "J.K. Rowling"),
      book(HARRY_POTTER[4], "J.K. Rowling")
    ];
    const { groups } = buildSeries(books);
    expect(groups).toHaveLength(1);
    const [potter] = groups;
    expect(potter.name).toBe("Harry Potter");
    expect(potter.members.map((member) => member.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(potter.members[0].book.title).toBe("Harry Potter and the Philosopher's Stone");
    expect(potter.total).toBe(7);
    expect(potter.missing).toEqual([]);
    expect(potter.next?.title).toBe("Harry Potter and the Philosopher's Stone");
  });

  it("knows which books of a known series are missing, and what is up next", () => {
    const books = [
      book("The Hunger Games", "Suzanne Collins", { progress: 1 }),
      book("Mockingjay", "Suzanne Collins")
    ];
    const [games] = buildSeries(books).groups;
    expect(games.missing.map((entry) => entry.title)).toEqual([
      "Catching Fire",
      "The Ballad of Songbirds and Snakes",
      "Sunrise on the Reaping"
    ]);
    expect(games.finishedCount).toBe(1);
    expect(games.next?.title).toBe("Mockingjay");
    // Book 2 comes before Mockingjay and is not here: that is what is next.
    expect(games.missingNext).toEqual({ index: 2, title: "Catching Fire" });
    expect(games.upNext).toBe(false);
  });

  it("is up next when the following book is in the library", () => {
    const [games] = buildSeries([
      book("The Hunger Games", "Suzanne Collins", { progress: 1 }),
      book("Catching Fire", "Suzanne Collins")
    ]).groups;
    expect(games.upNext).toBe(true);
    expect(games.missingNext).toBeNull();
  });

  it("does not claim a book of the same title by someone else", () => {
    const { groups, byBook } = buildSeries([
      book("Twilight", "Someone Else"),
      book("Eclipse", "Someone Else"),
      book("Eclipse", null)
    ]);
    expect(groups).toEqual([]);
    expect(byBook.size).toBe(0);
  });

  it("uses the series stored on the book first, and the reader's 'none' stops every guess", () => {
    const stated = book("Mort", "Terry Pratchett", { series: "Discworld", seriesIndex: 4 });
    const other = book("Guards! Guards!", "Terry Pratchett", { series: "Discworld", seriesIndex: 8 });
    const refused = book("Harry Potter and the Goblet of Fire", "J.K. Rowling", { series: "" });
    const { groups, byBook } = buildSeries([stated, other, refused]);
    expect(groups.map((group) => group.name)).toEqual(["Discworld"]);
    // Numbers stated but not continuous: the gaps are the missing books.
    expect(groups[0].missing.map((entry) => entry.index)).toEqual([1, 2, 3, 5, 6, 7]);
    expect(byBook.has(refused.id)).toBe(false);
  });

  it("joins names written differently, and a known series' alias", () => {
    const { groups } = buildSeries([
      book("Leviathan Wakes (The Expanse, #1)", "James S. A. Corey"),
      book("Caliban's War", "James S.A. Corey", { series: "Expanse", seriesIndex: 2 }),
      book("The Magician's Nephew", "C. S. Lewis", { series: "Narnia", seriesIndex: 1 }),
      book("Prince Caspian", "C.S. Lewis")
    ]);
    expect(groups.map((group) => [group.name, group.members.length])).toEqual([
      ["The Chronicles of Narnia", 2],
      ["The Expanse", 2]
    ]);
  });

  it("groups one author's titles that share a start, but not a lone weak hint", () => {
    const { groups, byBook } = buildSeries([
      book("Diary of a Wimpy Kid: Rodrick Rules", "Jeff Kinney"),
      book("Diary of a Wimpy Kid: The Last Straw", "Jeff Kinney"),
      book("Apollo 13: The Mission", "Someone")
    ]);
    expect(groups.map((group) => [group.name, group.members.length])).toEqual([["Diary of a Wimpy Kid", 2]]);
    expect([...byBook.values()].some((info) => info.name === "Apollo")).toBe(false);
  });

  it("is not a series when the only two books are one book twice", () => {
    const { groups, byBook } = buildSeries([book("Dune", "Frank Herbert"), book("Dune (Deluxe Edition)", "Frank Herbert")]);
    expect(groups).toEqual([]);
    // Each copy still knows its series, for its card.
    expect([...byBook.values()].map((info) => info.name)).toEqual(["Dune", "Dune"]);
  });

  it("counts two copies of one book once", () => {
    const { groups } = buildSeries([
      book("A Game of Thrones", "George R. R. Martin", { progress: 1 }),
      book("A Game of Thrones: A Song of Ice and Fire", "George R.R. Martin"),
      book("A Clash of Kings", "George R. R. Martin")
    ]);
    expect(groups[0].ownedCount).toBe(2);
    expect(groups[0].finishedCount).toBe(1);
    expect(groups[0].next?.title).toBe("A Clash of Kings");
  });
});

describe("seriesFromTitle", () => {
  it.each([
    ["Leviathan Wakes (The Expanse, #1)", "The Expanse", 1, "strong"],
    ["The Colour of Magic [Discworld 01]", "Discworld", 1, "strong"],
    ["The Dragon Reborn: Book Three of the Wheel of Time", "the Wheel of Time", 3, "strong"],
    ["Discworld #4 - Mort", "Discworld", 4, "strong"],
    ["The Expanse, Book 2: Caliban's War", "The Expanse", 2, "strong"],
    ["One Piece, Vol. 12", "One Piece", 12, "strong"],
    ["Harry Potter 3 - The Prisoner of Azkaban", "Harry Potter", 3, "weak"],
    ["Killing Floor: A Jack Reacher Novel", "Jack Reacher", null, "weak"]
  ])("reads %s", (title, name, index, strength) => {
    expect(seriesFromTitle(title)).toEqual({ name, index, strength });
  });

  it.each(["The Hobbit (Illustrated Edition)", "1984", "Fahrenheit 451", "The Da Vinci Code: A Novel", "Penguin Classics (1984)"])(
    "finds nothing in %s",
    (title) => {
      expect(seriesFromTitle(title)).toBeNull();
    }
  );
});

describe("keys", () => {
  it("compares titles and authors loosely", () => {
    expect(titleKeys("The Lion, the Witch and the Wardrobe (Narnia #2)")).toEqual(["lion the witch and the wardrobe"]);
    expect(titleKeys("Mistborn: The Final Empire")).toEqual(["mistborn the final empire", "mistborn", "final empire"]);
    expect(authorKey("Ursula K. Le Guin")).toBe("guin");
    expect(authorKey("Robert Jordan and Brandon Sanderson")).toBe("jordan");
    expect(authorKey("Unknown")).toBeNull();
    expect(seriesKey("The Hunger Games Trilogy")).toBe(seriesKey("Hunger Games"));
  });
});

describe("shelves", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");

  it("sorts the library into reading, paused, finished and up next", () => {
    const reading = book("Current", "A", { progress: 0.4, lastOpened: "2026-09-27T10:00:00Z" });
    const paused = book("Old", "B", { progress: 0.2, lastOpened: "2026-06-01T10:00:00Z", createdAt: "2026-01-01T00:00:00Z" });
    const done = book("The Hunger Games", "Suzanne Collins", { progress: 1, createdAt: "2026-01-01T00:00:00Z" });
    const next = book("Catching Fire", "Suzanne Collins", { createdAt: "2026-01-01T00:00:00Z" });
    const books = [reading, paused, done, next];
    const shelves = buildShelves(books, buildSeries(books), now);
    const ids = (id: string) => shelves.find((shelf) => shelf.id === id)?.books.map((item) => item.title);
    expect(ids("reading")).toEqual(["Current"]);
    expect(ids("paused")).toEqual(["Old"]);
    expect(ids("finished")).toEqual(["The Hunger Games"]);
    expect(ids("up-next")).toEqual(["Catching Fire"]);
    expect(ids("recent")).toEqual(["Current"]);
    // Empty shelves are left out.
    expect(ids("duplicates")).toBeUndefined();
  });

  it("finds the same book twice", () => {
    const epub = book("Dune", "Frank Herbert");
    const pdf = book("Dune (Deluxe Edition)", "Herbert, Frank");
    expect(findDuplicates([epub, pdf, book("Dune Messiah", "Frank Herbert")])).toEqual([[epub, pdf]]);
  });
});
