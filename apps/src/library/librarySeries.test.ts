import { describe, expect, it } from "vitest";
import type { Book } from "@shared/models/book";
import { buildSeries, librarySeries, normalizeTitle } from "./series";

let nextId = 1;
const book = (title: string, author: string | null, extra: Partial<Book> = {}): Book => ({
  id: `ls${nextId++}`,
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

const mistborn = () => [
  book("The Final Empire", "Brandon Sanderson", { series: "Mistborn", seriesIndex: 1 }),
  book("The Well of Ascension", "Brandon Sanderson", { series: "Mistborn", seriesIndex: 2 }),
  book("The Hero of Ages", "Brandon Sanderson", { series: "Mistborn", seriesIndex: 3 }),
  book("A Book of Its Own", "Someone Else")
];

describe("librarySeries", () => {
  it("keeps a book's entry the same object while what it says is unchanged", () => {
    const books = mistborn();
    const first = librarySeries(books);
    const firstInfo = first.byBook.get(books[0].id);
    expect(firstInfo).toMatchObject({ name: "Mistborn", index: 1 });

    // Another book's progress moves: a new library array, as the store makes it.
    const moved = books.map((one, at) => (at === 1 ? { ...one, progress: 0.4 } : one));
    const second = librarySeries(moved);
    expect(second).not.toBe(first);
    expect(second.byBook.get(books[0].id)).toBe(firstInfo);
    // The groups are worked out afresh: they carry progress.
    expect(second.groups[0].members.find((member) => member.book.id === books[1].id)?.book.progress).toBe(0.4);
  });

  it("gives a new entry once a book's series changes", () => {
    const books = mistborn();
    const before = librarySeries(books).byBook.get(books[2].id);
    const renumbered = books.map((one, at) => (at === 2 ? { ...one, seriesIndex: 4 } : one));
    const after = librarySeries(renumbered).byBook.get(books[2].id);
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ name: "Mistborn", index: 4 });
  });

  it("says what buildSeries says", () => {
    const books = mistborn();
    const built = buildSeries(books);
    const shared = librarySeries([...books]);
    expect([...shared.byBook.entries()]).toEqual([...built.byBook.entries()]);
    expect(shared.groups).toEqual(built.groups);
  });

  it("normalises a title the same way the second time", () => {
    expect(normalizeTitle("The Lord of the Rings: Él")).toBe("lord of the rings el");
    expect(normalizeTitle("The Lord of the Rings: Él")).toBe("lord of the rings el");
  });
});
