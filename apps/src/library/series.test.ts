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

describe("a series in parts, with books beside it", () => {
  const SANDERSON = "Brandon Sanderson";

  it("takes in a book whose file wrote its title where the author goes", () => {
    const { groups } = buildSeries([
      book("The Final Empire", SANDERSON),
      book("The Well of Ascension", "The Well of Ascension"),
      book("The Hero of Ages: Book Three of Mistborn", SANDERSON)
    ]);
    expect(groups.map((group) => [group.name, group.author])).toEqual([["Mistborn", SANDERSON]]);
    expect(groups[0].members.map((member) => member.index)).toEqual([1, 2, 3]);
  });

  it("takes in a book of a series already here whatever its file says of its author, but not a short title", () => {
    const { groups } = buildSeries([
      book("The Final Empire", SANDERSON),
      book("The Alloy of Law", "Tor Books"),
      book("Twilight", "Stephenie Meyer"),
      book("New Moon", "Stephenie Meyer"),
      book("Eclipse", "Someone Else")
    ]);
    expect(groups.map((group) => [group.name, group.members.map((member) => member.index)])).toEqual([
      ["Mistborn", [1, 4]],
      ["Twilight", [1, 2]]
    ]);
  });

  it("reads the underscore a file's name has for a colon", () => {
    const { groups } = buildSeries([
      book("The Final Empire", SANDERSON),
      book("The Well of Ascension _ book two of Mistborn", SANDERSON),
      book("Mistborn _ Secret History", SANDERSON)
    ]);
    expect(groups.map((group) => [group.name, group.members.map((member) => member.index)])).toEqual([["Mistborn", [1, 2, 6.5]]]);
  });

  it("counts a part's number from the part's first book", () => {
    const { groups } = buildSeries([
      book("The Final Empire", SANDERSON),
      book("The Alloy of Law", SANDERSON, { series: "Wax and Wayne", seriesIndex: 1 }),
      // (A title the list does not know: its number is all there is.)
      book("Shadows of Self: A Novel", SANDERSON, { series: "Mistborn: Wax and Wayne", seriesIndex: 2 })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((member) => member.index)).toEqual([1, 4, 5]);
  });

  it("says where each part begins and ends", () => {
    const [mistborn] = buildSeries([book("The Final Empire", SANDERSON), book("The Hero of Ages", SANDERSON)]).groups;
    expect(mistborn.parts).toEqual([
      { name: "Era One", from: 1, to: 3 },
      { name: "Era Two: Wax and Wayne", from: 4, to: 7 }
    ]);
    const [dune] = buildSeries([book("Dune", "Frank Herbert"), book("Dune Messiah", "Frank Herbert")]).groups;
    expect(dune.parts).toEqual([]);
  });

  it("keeps a novella out of the counts, out of what is missing, and out of what is next", () => {
    const novella = book("Mistborn: Secret History", SANDERSON, { series: "Mistborn", seriesIndex: 3.5 });
    const [mistborn] = buildSeries([
      book("The Final Empire", SANDERSON, { progress: 1 }),
      novella,
      book("The Bands of Mourning", SANDERSON)
    ]).groups;
    // Read where the list says, not where its file numbers it.
    expect(mistborn.members.map((member) => [member.index, member.extra])).toEqual([
      [1, undefined],
      [6, undefined],
      [6.5, "Novella"]
    ]);
    expect([mistborn.total, mistborn.ownedCount, mistborn.finishedCount]).toEqual([7, 2, 1]);
    expect(mistborn.missing.map((entry) => entry.index)).toEqual([2, 3, 4, 5, 7]);
    expect(mistborn.missingExtras).toEqual([]);
    expect(mistborn.next?.title).toBe("The Bands of Mourning");

    const [stormlight] = buildSeries([
      book("The Way of Kings", SANDERSON, { progress: 1 }),
      book("Words of Radiance", SANDERSON, { progress: 1 }),
      book("Edgedancer", SANDERSON),
      book("Oathbringer", SANDERSON)
    ]).groups;
    expect(stormlight.next?.title).toBe("Oathbringer");
    expect(stormlight.missingExtras).toEqual([{ index: 3.5, title: "Dawnshard", kind: "Novella" }]);
  });

  it("offers an extra once the main line is read", () => {
    const [stormlight] = buildSeries([book("The Way of Kings", SANDERSON, { progress: 1 }), book("Edgedancer", SANDERSON)]).groups;
    expect(stormlight.next?.title).toBe("Edgedancer");
    expect(stormlight.finishedCount).toBe(1);
  });
});

describe("a series as a real library holds it", () => {
  // Books 1, 2, 5 and 6 of six, the first two each in two formats, and the
  // series named three ways: stated by one file under one name and by another
  // under a second, and worked out from the title for the rest.
  const library = () => [
    book("Light Bringer", "Pierce Brown"),
    book("Golden Son", "Pierce Brown", { series: "Red Rising", seriesIndex: 2 }),
    book("Red Rising", "Pierce Brown", { series: "The Red Rising Trilogy", seriesIndex: 1 }),
    book("Dark Age", "Pierce Brown"),
    book("Golden Son", "Pierce Brown"),
    book("Red Rising", "Pierce Brown", { series: "Red Rising Trilogy", seriesIndex: 1 })
  ];

  it("is one series in order, and two copies of a book are one book", () => {
    const { groups } = buildSeries(library());
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Red Rising");
    expect(groups[0].members.map((member) => `${member.index} ${member.book.title}`)).toEqual([
      "1 Red Rising",
      "1 Red Rising",
      "2 Golden Son",
      "2 Golden Son",
      "5 Dark Age",
      "6 Light Bringer"
    ]);
    expect([groups[0].ownedCount, groups[0].total]).toEqual([4, 6]);
    expect(groups[0].missing).toEqual([
      { index: 3, title: "Morning Star" },
      { index: 4, title: "Iron Gold" }
    ]);
    expect(findDuplicates(library()).map((copies) => copies.map((copy) => copy.title))).toEqual([
      ["Golden Son", "Golden Son"],
      ["Red Rising", "Red Rising"]
    ]);
  });

  it("finishing one copy finishes the book", () => {
    const books = library();
    books[2] = { ...books[2], progress: 1 };
    let group = buildSeries(books).groups[0];
    expect([group.finishedCount, group.next?.title, group.upNext]).toEqual([1, "Golden Son", true]);
    // Then the other format of book 2: what is next is a book the library lacks.
    books[4] = { ...books[4], progress: 1 };
    group = buildSeries(books).groups[0];
    expect([group.finishedCount, group.next?.title, group.upNext]).toEqual([2, "Dark Age", false]);
    expect(group.missingNext).toEqual({ index: 3, title: "Morning Star" });
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

  it.each([
    "The Hobbit (Illustrated Edition)",
    "1984",
    "Fahrenheit 451",
    "The Da Vinci Code: A Novel",
    "Penguin Classics (1984)",
    // A number with no series named: these were all books of a series called "Book" (or "Volume").
    "The Glass Road Saltmarsh Triology (Book 1)",
    "Night Ferry (Book Two)",
    "Night Ferry (Volume 2)",
    "Night Ferry [Vol. 3]",
    "Night Ferry (Part 2)",
    "Night Ferry (Edition 2)"
  ])(
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
