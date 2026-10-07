import { describe, expect, it } from "vitest";
import { orderHighlights } from "../components/highlights/highlightsView";
import type { Annotation } from "../services/annotationService";
import {
  compareKindlePlaces,
  isKindlePlace,
  kindleLocation,
  kindlePlace,
  parseAdded,
  parseClippings,
  splitTitleLine,
  textHash
} from "./kindleClippings";

const RULE = "==========";

/** One entry as the Kindle writes it. */
const entry = (title: string, heading: string, body = "") => [title, heading, "", body, RULE].join("\n");
/** A file of entries, ended as the Kindle ends it. */
const file = (...entries: string[]) => `${entries.join("\n")}\n`;

const SALT = "The Salt Road (Maren Voss)";
const on = (what: string, where: string, when = "Monday, March 4, 2024 10:15:32 PM") => `- Your ${what} on ${where} | Added on ${when}`;

describe("the title line", () => {
  it("is a title and, in the last brackets, an author", () => {
    expect(splitTitleLine("The Salt Road (Maren Voss)")).toEqual({ title: "The Salt Road", author: "Maren Voss" });
    expect(splitTitleLine("The Salt Road (Voss, Maren)")).toEqual({ title: "The Salt Road", author: "Voss, Maren" });
  });

  it("keeps the brackets a title has of its own", () => {
    expect(splitTitleLine("Emberfall (The Tide Cycle Book 2) (Maren Voss)")).toEqual({
      title: "Emberfall (The Tide Cycle Book 2)",
      author: "Maren Voss"
    });
    expect(splitTitleLine("Low Water (a story) (Voss, Maren (ed.))")).toEqual({ title: "Low Water (a story)", author: "Voss, Maren (ed.)" });
  });

  it("is all title when nothing is in brackets at its end", () => {
    expect(splitTitleLine("notes-from-the-ferry")).toEqual({ title: "notes-from-the-ferry", author: null });
    expect(splitTitleLine("Emberfall (draft) two")).toEqual({ title: "Emberfall (draft) two", author: null });
    expect(splitTitleLine("(Untitled)")).toEqual({ title: "(Untitled)", author: null });
    expect(splitTitleLine("Half open) (")).toEqual({ title: "Half open) (", author: null });
  });

  it("is read without the mark the Kindle starts it with, or the spaces round it", () => {
    expect(splitTitleLine("﻿The Salt Road (Maren Voss)  ")).toEqual({ title: "The Salt Road", author: "Maren Voss" });
  });
});

describe("the date the Kindle writes", () => {
  it("is read in the American form, afternoon and morning", () => {
    expect(parseAdded("Monday, March 4, 2024 10:15:32 PM")).toBe("2024-03-04T22:15:32");
    expect(parseAdded("Monday, March 4, 2024 10:15:32 AM")).toBe("2024-03-04T10:15:32");
    expect(parseAdded("Sunday, December 31, 2023 12:00:05 AM")).toBe("2023-12-31T00:00:05");
    expect(parseAdded("Sunday, December 31, 2023 12:00:05 PM")).toBe("2023-12-31T12:00:05");
  });

  it("is read in the British form, by the 24-hour clock", () => {
    expect(parseAdded("Monday, 4 March 2024 22:15:32")).toBe("2024-03-04T22:15:32");
    expect(parseAdded("Tuesday, 5 March 2024 00:01:02")).toBe("2024-03-05T00:01:02");
  });

  it("is read as an older Kindle wrote it, with no seconds", () => {
    expect(parseAdded("Sunday, March 04, 2012, 10:15 PM")).toBe("2012-03-04T22:15:00");
  });

  it("is nothing when it is not a date this reads", () => {
    expect(parseAdded("Montag, 4. März 2024 22:15:32")).toBeNull();
    expect(parseAdded("Monday, Smarch 4, 2024 10:15:32 PM")).toBeNull();
    expect(parseAdded("Monday, March 4, 2024 13:15:32 PM")).toBeNull();
    expect(parseAdded("Monday, March 4, 2024 25:15:32")).toBeNull();
    expect(parseAdded("")).toBeNull();
  });
});

describe("reading a clippings file", () => {
  it("reads a highlight: its book, its words, where and when", () => {
    const books = parseClippings(file(entry(SALT, on("Highlight", "page 12 | Location 123-125"), "The tide kept its own ledger.")));
    expect(books).toEqual([
      {
        title: "The Salt Road",
        author: "Maren Voss",
        clippings: [
          { text: "The tide kept its own ledger.", note: null, location: 123, locationEnd: 125, page: "12", addedAt: "2024-03-04T22:15:32" }
        ]
      }
    ]);
  });

  it("reads the three kinds: a highlight, a note with it, and no bookmark", () => {
    const [book] = parseClippings(
      file(
        entry(SALT, on("Bookmark", "page 3 | Location 40")),
        entry(SALT, on("Highlight", "page 12 | Location 123-125"), "The tide kept its own ledger."),
        entry(SALT, on("Note", "page 12 | Location 125"), "Like the harbour master."),
        entry(SALT, on("Bookmark", "Location 900"))
      )
    );
    expect(book.clippings).toHaveLength(1);
    expect(book.clippings[0]).toMatchObject({ text: "The tide kept its own ledger.", note: "Like the harbour master.", location: 123 });
  });

  it("takes a page or a location alone, and the other ways the Kindle has said them", () => {
    const [book] = parseClippings(
      file(
        entry(SALT, on("Highlight", "page 7"), "Only a page."),
        entry(SALT, on("Highlight", "Location 88"), "Only a location."),
        entry(SALT, "- Your Highlight at location 301-302 | Added on Monday, 4 March 2024 22:15:32", "At a location."),
        entry(SALT, "- Your Highlight on page xiv | location 9-10 | Added on Monday, March 4, 2024 10:15:32 PM", "In the preface."),
        entry(SALT, "- Highlight Loc. 1234-36 | Added on Sunday, March 04, 2012, 10:15 PM", "From an old Kindle."),
        entry(SALT, "- Highlight on Page 40 | Loc. 998-1002 | Added on Sunday, March 04, 2012, 10:15 PM", "Over a thousand.")
      )
    );
    expect(book.clippings.map(({ text, page, location, locationEnd }) => [text, page, location, locationEnd])).toEqual([
      ["Only a page.", "7", null, null],
      ["Only a location.", null, 88, 88],
      ["At a location.", null, 301, 302],
      ["In the preface.", "xiv", 9, 10],
      ["From an old Kindle.", null, 1234, 1236],
      ["Over a thousand.", "40", 998, 1002]
    ]);
    expect(book.clippings[2].addedAt).toBe("2024-03-04T22:15:32");
    expect(book.clippings[4].addedAt).toBe("2012-03-04T22:15:00");
  });

  it("keeps the books apart, in the order the file meets them", () => {
    const books = parseClippings(
      file(
        entry("Emberfall (The Tide Cycle Book 2) (Voss, Maren)", on("Highlight", "Location 10-11"), "First."),
        entry(SALT, on("Highlight", "Location 20-21"), "Second."),
        entry("Emberfall (The Tide Cycle Book 2) (Voss, Maren)", on("Highlight", "Location 30-31"), "Third."),
        entry("notes-from-the-ferry", on("Highlight", "Location 1-2"), "Fourth.")
      )
    );
    expect(books.map((book) => [book.title, book.author, book.clippings.map((item) => item.text)])).toEqual([
      ["Emberfall (The Tide Cycle Book 2)", "Voss, Maren", ["First.", "Third."]],
      ["The Salt Road", "Maren Voss", ["Second."]],
      ["notes-from-the-ferry", null, ["Fourth."]]
    ]);
  });

  it("keeps the last of a highlight that was made longer, or shorter", () => {
    const [book] = parseClippings(
      file(
        entry(SALT, on("Highlight", "Location 123-124"), "The tide kept"),
        entry(SALT, on("Highlight", "Location 200-203"), "A long passage that was cut down afterwards."),
        entry(SALT, on("Highlight", "Location 123-125", "Monday, March 4, 2024 10:16:00 PM"), "The tide kept its own ledger."),
        entry(SALT, on("Highlight", "Location 200-201"), "A long passage"),
        // Made longer at its start: another location, the same passage.
        entry(SALT, on("Highlight", "Location 122-125", "Monday, March 4, 2024 10:17:00 PM"), "Out past the bar. The tide kept its own ledger.")
      )
    );
    expect(book.clippings.map((item) => [item.location, item.text])).toEqual([
      [200, "A long passage"],
      [122, "Out past the bar. The tide kept its own ledger."]
    ]);
    expect(book.clippings[1].addedAt).toBe("2024-03-04T22:17:00");
  });

  it("keeps two highlights that only start at the same location", () => {
    const [book] = parseClippings(
      file(
        entry(SALT, on("Highlight", "Location 123-123"), "The tide kept its own ledger."),
        entry(SALT, on("Highlight", "Location 123-124"), "Nobody asked the gulls."),
        // The very same words twice are one.
        entry(SALT, on("Highlight", "Location 123-123"), "The  tide kept\nits own ledger.")
      )
    );
    expect(book.clippings.map((item) => item.text)).toEqual(["Nobody asked the gulls.", "The  tide kept\nits own ledger."]);
  });

  it("does not take one book's highlight for another's edit", () => {
    const books = parseClippings(
      file(
        entry(SALT, on("Highlight", "Location 123-125"), "The tide kept its own ledger."),
        entry("Emberfall (Maren Voss)", on("Highlight", "Location 123-125"), "The tide kept its own ledger.")
      )
    );
    expect(books.map((book) => book.clippings.length)).toEqual([1, 1]);
  });

  it("gives a note to the highlight its location is inside, whichever the file has first", () => {
    const [book] = parseClippings(
      file(
        // The Kindle often writes the note before its highlight.
        entry(SALT, on("Note", "page 12 | Location 125"), "Like the harbour master."),
        entry(SALT, on("Highlight", "page 12 | Location 123-125"), "The tide kept its own ledger."),
        entry(SALT, on("Highlight", "Location 300-310"), "A long one."),
        entry(SALT, on("Note", "Location 304"), "In its middle."),
        entry(SALT, on("Note", "Location 310"), "At its end."),
        entry(SALT, on("Highlight", "Location 400-401"), "No note here.")
      )
    );
    expect(book.clippings.map((item) => [item.text, item.note])).toEqual([
      ["The tide kept its own ledger.", "Like the harbour master."],
      ["A long one.", "In its middle.\n\nAt its end."],
      ["No note here.", null]
    ]);
  });

  it("gives a note at the seam of two highlights to the one that ends there", () => {
    const [book] = parseClippings(
      file(
        entry(SALT, on("Highlight", "Location 100-105"), "The first passage."),
        entry(SALT, on("Highlight", "Location 105-109"), "The one after it."),
        entry(SALT, on("Note", "Location 105"), "About the first.")
      )
    );
    expect(book.clippings.map((item) => item.note)).toEqual(["About the first.", null]);
  });

  it("keeps the last of a note that was edited", () => {
    const [book] = parseClippings(
      file(
        entry(SALT, on("Highlight", "Location 123-125"), "The tide kept its own ledger."),
        entry(SALT, on("Note", "Location 125"), "Like the harbor"),
        entry(SALT, on("Note", "Location 125"), "Like the harbour master.")
      )
    );
    expect(book.clippings).toHaveLength(1);
    expect(book.clippings[0].note).toBe("Like the harbour master.");
  });

  it("keeps a note written where nothing was highlighted, as a note with no passage", () => {
    const [book] = parseClippings(
      file(
        entry(SALT, on("Highlight", "Location 123-125"), "The tide kept its own ledger."),
        entry(SALT, on("Note", "page 30 | Location 500"), "Who is the pilot?\nAsk again in part two.")
      )
    );
    expect(book.clippings[1]).toEqual({
      text: "",
      note: "Who is the pilot?\nAsk again in part two.",
      location: 500,
      locationEnd: 500,
      page: "30",
      addedAt: "2024-03-04T22:15:32"
    });
  });

  it("leaves out an entry the Kindle would not copy", () => {
    const books = parseClippings(
      file(
        entry(SALT, on("Highlight", "Location 123-125"), "The tide kept its own ledger."),
        entry(SALT, on("Highlight", "Location 200-240"), " <You have reached the clipping limit for this item>"),
        entry("Emberfall (Maren Voss)", on("Highlight", "Location 5-9"), "<You have reached the clipping limit for this item>")
      )
    );
    expect(books).toHaveLength(1);
    expect(books[0].clippings.map((item) => item.text)).toEqual(["The tide kept its own ledger."]);
  });

  it("leaves out entries with no words", () => {
    expect(parseClippings(file(entry(SALT, on("Highlight", "Location 123-125"), "   "), entry(SALT, on("Note", "Location 125"))))).toEqual([]);
  });

  it("reads a file with the Kindle's marks and line ends", () => {
    const plain = file(
      entry(SALT, on("Highlight", "page 12 | Location 123-125"), "The tide kept its own ledger."),
      entry(SALT, on("Note", "page 12 | Location 125"), "Like the harbour master."),
      entry(SALT, on("Highlight", "Location 300-301"), "Nobody asked the gulls.")
    );
    const expected = parseClippings(plain);
    expect(expected[0].clippings).toHaveLength(2);
    // A byte-order mark before the file, and before every title; CRLF; a file with no last line end.
    const marked = `﻿${plain.split(`${RULE}\n`).join(`${RULE}\n﻿`)}`.replace(/﻿$/, "");
    expect(parseClippings(marked)).toEqual(expected);
    expect(parseClippings(marked.replace(/\n/g, "\r\n"))).toEqual(expected);
    expect(parseClippings(plain.replace(/\n/g, "\r"))).toEqual(expected);
    expect(parseClippings(plain.trimEnd().slice(0, -RULE.length))).toEqual(expected);
  });

  it("keeps the words of an entry in another language, with no place and no date", () => {
    const title = "Der Salzweg (Maren Voss)";
    const [book] = parseClippings(
      file(
        entry(title, "- Ihre Markierung auf Seite 12 | Position 123-125 | Hinzugefügt am Montag, 4. März 2024 22:15:32", "Die Flut führte ihr eigenes Buch."),
        entry(title, "- Ihr Lesezeichen auf Seite 3 | Position 40 | Hinzugefügt am Montag, 4. März 2024 22:16:00"),
        entry(title, "- Ihre Markierung auf Seite 12 | Position 123-125 | Hinzugefügt am Montag, 4. März 2024 22:17:00", "Die Flut führte ihr eigenes Buch."),
        entry(title, "- 位置No. 300-301のハイライト |作成日: 2024年3月4日月曜日 22:18:00", "Niemand fragte die Möwen.")
      )
    );
    expect(book).toEqual({
      title: "Der Salzweg",
      author: "Maren Voss",
      clippings: [
        { text: "Die Flut führte ihr eigenes Buch.", note: null, location: null, locationEnd: null, page: null, addedAt: null },
        { text: "Niemand fragte die Möwen.", note: null, location: null, locationEnd: null, page: null, addedAt: null }
      ]
    });
  });

  it("makes nothing of an empty file, or of one that is not clippings", () => {
    expect(parseClippings("")).toEqual([]);
    expect(parseClippings("﻿")).toEqual([]);
    expect(parseClippings("\n\n\r\n")).toEqual([]);
    expect(parseClippings(`${RULE}\n${RULE}\n`)).toEqual([]);
    expect(parseClippings("A shopping list\nsalt\n")).toEqual([]);
    expect(parseClippings("Just one line")).toEqual([]);
  });

  it("reads a great many entries without slowing to a crawl", () => {
    const many = Array.from({ length: 4000 }, (_, index) => entry(SALT, on("Highlight", `Location ${index * 3 + 1}-${index * 3 + 2}`), `Passage number ${index}.`));
    const started = Date.now();
    const [book] = parseClippings(file(...many));
    expect(book.clippings).toHaveLength(4000);
    expect(Date.now() - started).toBeLessThan(4000);
  });
});

describe("a Kindle highlight's place", () => {
  const clip = (location: number | null, text = "words", note: string | null = null) => ({ location, text, note });

  it("is its location, or a short hash of its words where there is none", () => {
    expect(kindlePlace(clip(123))).toBe("kindle:123");
    expect(kindlePlace(clip(null))).toMatch(/^kindle:h[0-9a-f]{8}$/);
    expect(kindlePlace(clip(null))).toBe(kindlePlace(clip(null)));
    expect(kindlePlace(clip(null, "other words"))).not.toBe(kindlePlace(clip(null)));
    // A note with no passage is known by the note.
    expect(kindlePlace(clip(null, "", "a note"))).toBe(kindlePlace(clip(null, "a note")));
  });

  it("is told from a CFI and from a PDF's place", () => {
    expect(isKindlePlace("kindle:123")).toBe(true);
    expect(isKindlePlace("kindle:h0a1b2c3d")).toBe(true);
    expect(isKindlePlace("epubcfi(/6/4!/4/2,/1:0,/1:5)")).toBe(false);
    expect(isKindlePlace("pdf:3:1,2,3,4")).toBe(false);
    expect(isKindlePlace("")).toBe(false);
    expect(isKindlePlace(null)).toBe(false);
    expect(isKindlePlace(undefined)).toBe(false);
  });

  it("gives its location back, and none for a hash, even one all of digits", () => {
    expect(kindleLocation("kindle:123")).toBe(123);
    expect(kindleLocation("kindle:h12345678")).toBeNull();
    expect(kindleLocation("kindle:")).toBeNull();
    expect(kindleLocation("kindle:12x")).toBeNull();
    expect(kindleLocation("epubcfi(/6/4!/4/2)")).toBeNull();
    expect(kindleLocation(null)).toBeNull();
  });

  it("is ordered by location, with those that have none after", () => {
    expect(compareKindlePlaces("kindle:9", "kindle:123")).toBeLessThan(0);
    expect(compareKindlePlaces("kindle:123", "kindle:9")).toBeGreaterThan(0);
    expect(compareKindlePlaces("kindle:9", "kindle:9")).toBe(0);
    expect(compareKindlePlaces("kindle:habcdef01", "kindle:9")).toBeGreaterThan(0);
    expect(compareKindlePlaces("kindle:9", "kindle:habcdef01")).toBeLessThan(0);
    expect(compareKindlePlaces("kindle:habcdef01", "kindle:h00000000")).toBe(0);
  });

  it("hashes the same words the same way, always", () => {
    expect(textHash("The tide kept its own ledger.")).toBe(textHash("The tide kept its own ledger."));
    expect(textHash("The tide kept its own ledger.")).toMatch(/^[0-9a-f]{16}$/);
    expect(textHash("")).toMatch(/^[0-9a-f]{16}$/);
    const seen = new Set(Array.from({ length: 5000 }, (_, index) => textHash(`passage ${index}`)));
    expect(seen.size).toBe(5000);
  });
});

describe("Kindle highlights among a book's own", () => {
  const item = (id: string, cfi: string, createdAt = "2026-09-28T10:00:00Z"): Annotation => ({
    id,
    bookId: "b",
    kind: "highlight",
    cfi,
    text: id,
    createdAt,
    updatedAt: createdAt
  });
  /** Stands in for comparing CFIs: numbers compare, anything else cannot be read. */
  const compare = (a: string, b: string) => {
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) {
      throw new Error("unreadable");
    }
    return Number(a) - Number(b);
  };

  it("come after those with a place, by location, however the list arrives", () => {
    const list = [
      item("k-late", "kindle:900"),
      item("second", "2"),
      item("k-nowhere-new", "kindle:hbbbbbbbb", "2024-05-01T10:00:00Z"),
      item("k-early", "kindle:12"),
      item("broken", "not a place"),
      item("first", "1"),
      item("k-nowhere-old", "kindle:haaaaaaaa", "2024-04-01T10:00:00Z"),
      item("k-middle", "kindle:300")
    ];
    const expected = ["first", "second", "k-early", "k-middle", "k-late", "k-nowhere-old", "k-nowhere-new", "broken"];
    expect(orderHighlights(list, compare).map((entry) => entry.id)).toEqual(expected);
    expect(orderHighlights([...list].reverse(), compare).map((entry) => entry.id)).toEqual(expected);
  });

  it("are never handed to the comparison of places", () => {
    const seen: string[] = [];
    orderHighlights([item("k1", "kindle:5"), item("a", "1"), item("k2", "kindle:2")], (a, b) => {
      seen.push(a, b);
      return compare(a, b);
    });
    expect(seen.some(isKindlePlace)).toBe(false);
  });

  it("two at one location are in the order they were made", () => {
    const list = [item("later", "kindle:5", "2024-05-02T10:00:00Z"), item("earlier", "kindle:5", "2024-05-01T10:00:00Z")];
    expect(orderHighlights(list, compare).map((entry) => entry.id)).toEqual(["earlier", "later"]);
  });
});
