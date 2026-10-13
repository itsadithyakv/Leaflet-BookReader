import { describe, expect, it } from "vitest";
import type { Book } from "@shared/models/book";
import { faceOf, genreChoices, genreColours, genreKey, genreShelves, inGenre } from "./genres";

const book = (id: string, genres: string[], more: Partial<Book> = {}): Book =>
  ({
    id,
    title: id,
    author: null,
    genres,
    coverUrl: null,
    localPath: `/${id}.epub`,
    fileHash: id,
    progress: 0,
    lastOpened: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...more
  }) as Book;

describe("the library by genre", () => {
  it("gives each genre a shelf, the fullest first", () => {
    const shelves = genreShelves([
      book("dune", ["Science Fiction", "Classics"]),
      book("emma", ["Classics", "Romance"]),
      book("ulysses", ["Classics"]),
      book("notes", [])
    ]);
    expect(shelves.map((shelf) => [shelf.name, shelf.books.length])).toEqual([
      ["Classics", 3],
      ["Romance", 1],
      ["Science Fiction", 1]
    ]);
  });

  it("takes one genre spelt two ways as one, under its commonest spelling", () => {
    const shelves = genreShelves([
      book("a", ["fantasy"]),
      book("b", ["Fantasy "]),
      book("c", ["Fantasy", "FANTASY"]),
      book("d", ["Epic  fantasy"])
    ]);
    expect(shelves.map((shelf) => [shelf.key, shelf.name, shelf.books.map((item) => item.id)])).toEqual([
      ["fantasy", "Fantasy", ["a", "b", "c"]],
      ["epic fantasy", "Epic fantasy", ["d"]]
    ]);
  });

  it("takes another name for a genre as that genre: one tile, not two", () => {
    const shelves = genreShelves([
      book("dune", ["Science Fiction"]),
      book("foundation", ["Sci-Fi"]),
      book("neuromancer", ["sci-fi"]),
      book("hyperion", ["SF"]),
      book("solaris", ["scifi", "Science-Fiction"]),
      book("divergent", ["YA"]),
      book("the-giver", ["Young Adult"]),
      book("sapiens", ["Non-fiction"]),
      book("cosmos", ["Nonfiction"]),
      book("educated", ["non fiction", "Biography & Autobiography"]),
      book("steve-jobs", ["Biographies"])
    ]);
    expect(shelves.map((shelf) => [shelf.key, shelf.name, shelf.books.map((item) => item.id).sort()])).toEqual([
      ["science fiction", "Science Fiction", ["dune", "foundation", "hyperion", "neuromancer", "solaris"]],
      ["nonfiction", "Nonfiction", ["cosmos", "educated", "sapiens"]],
      // No book calls it "Biography": the commonest of what they do say, the first by the alphabet of two as common.
      ["biography", "Biographies", ["educated", "steve-jobs"]],
      ["young adult", "Young Adult", ["divergent", "the-giver"]]
    ]);
  });

  it("names the tile by the genre's own name, however many books use another", () => {
    const [shelf] = genreShelves([book("a", ["Sci-fi"]), book("b", ["Sci-fi"]), book("c", ["Sci-fi"]), book("d", ["Science Fiction"])]);
    expect(shelf.name).toBe("Science Fiction");
    // Only the other name in the library: the tile says what the books say.
    expect(genreShelves([book("a", ["Sci-fi"]), book("b", ["sci-fi"]), book("c", ["Sci-fi"])])[0].name).toBe("Sci-fi");
  });

  it("puts a book that gives a genre under two of its names in it once", () => {
    const [shelf, ...rest] = genreShelves([book("dune", ["Sci-fi", "Science Fiction", "SF"])]);
    expect(rest).toEqual([]);
    expect(shelf.books.map((item) => item.id)).toEqual(["dune"]);
  });

  it("leaves a genre that only looks alike alone", () => {
    const shelves = genreShelves([book("a", ["Science"]), book("b", ["Fiction"]), book("c", ["Historical Fiction"]), book("d", ["constructor"])]);
    expect(shelves.map((shelf) => shelf.key).sort()).toEqual(["constructor", "fiction", "historical fiction", "science"]);
  });

  it("lists one genre to filter by for each merged genre, in the order the library meets them", () => {
    const books = [
      book("foundation", ["Sci-fi", "Classics"]),
      book("dune", ["Science Fiction"]),
      book("emma", ["Classics ", "Romance"]),
      book("notes", [])
    ];
    expect(genreChoices(books)).toEqual([
      { key: "science fiction", name: "Science Fiction" },
      { key: "classics", name: "Classics" },
      { key: "romance", name: "Romance" }
    ]);
    // As the tiles name them.
    const tiles = new Map(genreShelves(books).map((shelf) => [shelf.key, shelf.name]));
    for (const choice of genreChoices(books)) {
      expect(tiles.get(choice.key)).toBe(choice.name);
    }
    expect(genreChoices([])).toEqual([]);
  });

  it("finds every book of a chosen genre, whichever way the book spells it", () => {
    const books = [
      book("dune", ["Science Fiction"]),
      book("foundation", ["Sci-Fi"]),
      book("hyperion", [" SF "]),
      book("solaris", ["Science  fiction", "Classics"]),
      book("emma", ["Classics"]),
      book("science", ["Science"]),
      book("notes", [])
    ];
    const chosen = (key: string) => books.filter((item) => inGenre(item, key)).map((item) => item.id);
    expect(chosen("science fiction")).toEqual(["dune", "foundation", "hyperion", "solaris"]);
    expect(chosen("classics")).toEqual(["solaris", "emma"]);
    // Every choice offered finds the books its tile holds.
    for (const shelf of genreShelves(books)) {
      expect(chosen(shelf.key).sort()).toEqual(shelf.books.map((item) => item.id).sort());
    }
    // A spelling is its genre's key, so a filter set by a spelling still finds them all.
    expect(genreKey("Sci-fi")).toBe("science fiction");
    expect(genreKey("  Historical   Fiction ")).toBe("historical fiction");
    expect(chosen(genreKey("sci fi"))).toEqual(chosen("science fiction"));
  });

  it("stands the books being read first, then the unread, then the finished", () => {
    const [shelf] = genreShelves([
      book("finished", ["History"], { progress: 1 }),
      book("unread-old", ["History"], { createdAt: "2026-02-01T00:00:00Z" }),
      book("unread-new", ["History"], { createdAt: "2026-09-01T00:00:00Z" }),
      book("reading-last-week", ["History"], { progress: 0.4, lastOpened: "2026-10-03T00:00:00Z" }),
      book("reading-today", ["History"], { progress: 0.1, lastOpened: "2026-10-11T00:00:00Z" })
    ]);
    expect(shelf.books.map((item) => item.id)).toEqual(["reading-today", "reading-last-week", "unread-new", "unread-old", "finished"]);
  });

  it("gives neighbouring tiles different colours, the same ones every time", () => {
    const shelves = genreShelves(["Classics", "Fantasy", "History", "Romance", "Science Fiction", "Poetry", "Horror", "Crime"].map((genre) => book(genre, [genre])));
    const colours = genreColours(shelves);
    expect(new Set(colours.values()).size).toBe(8);
    expect([...genreColours(shelves).entries()]).toEqual([...colours.entries()]);
  });

  it("puts a cover on the tile where the genre has one", () => {
    const [shelf] = genreShelves([book("bare", ["History"], { progress: 0.5 }), book("covered", ["History"], { coverUrl: "c.jpg" })]);
    expect(shelf.books[0].id).toBe("bare");
    expect(faceOf(shelf)?.id).toBe("covered");
    expect(faceOf({ key: "x", name: "X", books: [] })).toBeNull();
  });
});
