import { describe, expect, it } from "vitest";
import { SHOWN_MOST, findBooks, type BookChoice } from "./bookChoices";

// Most recently read first, as the post dialog lists them.
const SHELF: BookChoice[] = [
  { title: "The Well of Ascension", author: "Brandon Sanderson" },
  { title: "Animal Farm", author: "George Orwell" },
  { title: "The Final Empire", author: "Brandon Sanderson" },
  { title: "Dune", author: "Frank Herbert" },
  { title: "Wuthering Heights", author: "Emily Brontë" },
  { title: "The Lord of the Rings 3 - Kembalinya Sang Raja", author: "J. R. R. Tolkien" },
  { title: "Red Rising", author: "Pierce Brown" },
  { title: "Dark Age", author: "Pierce Brown" },
  { title: "The Alchemist", author: "Paulo Coelho" },
  { title: "White Nights", author: "Fyodor Dostoevsky" }
];
const titles = (query: string) => findBooks(SHELF, query).map((index) => SHELF[index].title);

describe("finding a book of your own to post about", () => {
  it("lists the books read most lately when nothing is typed, at most a handful", () => {
    expect(findBooks(SHELF, "")).toEqual([0, 1, 2, 3, 4, 5, 6, 7].slice(0, SHOWN_MOST));
    expect(findBooks(SHELF, "   ")).toHaveLength(Math.min(SHOWN_MOST, SHELF.length));
  });

  it("finds by any part of the title or the author, whatever the case", () => {
    expect(titles("dune")).toEqual(["Dune"]);
    expect(titles("ORWELL")).toEqual(["Animal Farm"]);
    expect(titles("sanderson")).toEqual(["The Well of Ascension", "The Final Empire"]);
    expect(titles("rings")).toEqual(["The Lord of the Rings 3 - Kembalinya Sang Raja"]);
  });

  it("needs every word typed, in either, in any order", () => {
    expect(titles("pierce red")).toEqual(["Red Rising"]);
    expect(titles("empire brandon")).toEqual(["The Final Empire"]);
    expect(titles("dune orwell")).toEqual([]);
  });

  it("puts a title that starts with what is typed first, then a word that does, then the rest", () => {
    // "da": "Dark Age" starts with it; nothing else does.
    expect(titles("da")[0]).toBe("Dark Age");
    // "wh": "White Nights" and "Wuthering Heights"' author do not start it, but "White" does as a title.
    expect(titles("whi")).toEqual(["White Nights"]);
    // "the" starts several titles: those first, the most lately read of them first.
    expect(titles("the").slice(0, 3)).toEqual(["The Well of Ascension", "The Final Empire", "The Lord of the Rings 3 - Kembalinya Sang Raja"]);
  });

  it("does not mind accents or apostrophes", () => {
    expect(titles("bronte")).toEqual(["Wuthering Heights"]);
    expect(titles("Brontë")).toEqual(["Wuthering Heights"]);
  });

  it("finds nothing for what is not there", () => {
    expect(findBooks(SHELF, "zzz")).toEqual([]);
    expect(findBooks([], "dune")).toEqual([]);
  });
});
