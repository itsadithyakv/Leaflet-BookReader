import { describe, expect, it, vi } from "vitest";
import type { Book } from "@shared/models/book";
import { annotationService } from "../services/annotationService";
import { isKindlePlace, parseClippings, type KindleBook, type KindleClipping } from "./kindleClippings";
import { findKindleBook, kindleAnnotations, kindleId, matchClippings, missedTitles, planKindleImport, planLine } from "./kindleImport";

const book = (id: string, title: string, author: string | null = null): Book => ({
  id,
  title,
  author,
  genres: [],
  coverUrl: null,
  localPath: `/books/${id}.epub`,
  fileHash: id,
  progress: 0,
  lastOpened: null,
  createdAt: "2026-01-01T00:00:00Z"
});

const clip = (text: string, location: number | null = null, more: Partial<KindleClipping> = {}): KindleClipping => ({
  text,
  note: null,
  location,
  locationEnd: location,
  page: null,
  addedAt: null,
  ...more
});

const kindle = (title: string, author: string | null, ...clippings: KindleClipping[]): KindleBook => ({
  title,
  author,
  clippings: clippings.length > 0 ? clippings : [clip("Some words.", 10)]
});

/** The id of the book a Kindle title is found to be, or why not. */
const found = (title: string, author: string | null, library: Book[]) => {
  const result = findKindleBook(title, author, library);
  return result === null || result === "ambiguous" ? result : result.id;
};

describe("finding a Kindle book in the library", () => {
  const library = [
    book("salt", "The Salt Road", "Maren Voss"),
    book("ember", "Emberfall", "Maren Voss"),
    book("ferry", "Notes from the Ferry", null),
    book("glass", "A Glass Harbour: Letters, 1911 to 1914", "Odile Brandt")
  ];

  it("goes by the title, however it is cased, accented or punctuated", () => {
    expect(found("The Salt Road", "Maren Voss", library)).toBe("salt");
    expect(found("THE SALT ROAD", "Maren Voss", library)).toBe("salt");
    expect(found("Salt Road, The", "Maren Voss", library)).toBeNull();
    expect(found("the salt-road", "Maren Voss", library)).toBe("salt");
    expect(found("Émberfall", "Maren Voss", library)).toBe("ember");
    expect(found("Notes from the Ferry!", null, library)).toBe("ferry");
    expect(found("The Salt Roads", "Maren Voss", library)).toBeNull();
  });

  it("knows an author written surname first", () => {
    expect(found("The Salt Road", "Voss, Maren", library)).toBe("salt");
    expect(found("The Salt Road", "VOSS, MAREN", library)).toBe("salt");
    expect(found("The Salt Road", "M. Voss", library)).toBe("salt");
    expect(found("A Glass Harbour: Letters, 1911 to 1914", "Brandt, Odile;Voss, Maren", library)).toBe("glass");
    expect(found("The Salt Road", "Voss, Maren", [book("salt", "The Salt Road", "Voss, Maren")])).toBe("salt");
  });

  it("does not give one writer's highlights to another's book of the same name", () => {
    expect(found("The Salt Road", "Ines Okafor", library)).toBeNull();
    expect(found("Emberfall", "Okafor, Ines", library)).toBeNull();
  });

  it("goes by the title alone when either side names no author", () => {
    expect(found("The Salt Road", null, library)).toBe("salt");
    expect(found("Notes from the Ferry", "Maren Voss", library)).toBe("ferry");
    expect(found("The Salt Road", "Unknown", library)).toBe("salt");
  });

  it("sets aside what the Kindle adds in brackets", () => {
    expect(found("Emberfall (The Tide Cycle Book 2)", "Voss, Maren", library)).toBe("ember");
    expect(found("The Salt Road [Kindle Edition]", "Maren Voss", library)).toBe("salt");
    expect(found("The Salt Road", "Maren Voss", [book("salt", "The Salt Road (The Tide Cycle, #1)", "Maren Voss")])).toBe("salt");
  });

  it("allows a subtitle on one side only", () => {
    expect(found("A Glass Harbour", "Odile Brandt", library)).toBe("glass");
    expect(found("The Salt Road: A Novel", "Maren Voss", library)).toBe("salt");
    expect(found("The Salt Road - A Novel of the Coast", "Maren Voss", library)).toBe("salt");
    // Two subtitles that differ are two books.
    expect(found("A Glass Harbour: The Later Letters", "Odile Brandt", library)).toBeNull();
    // And a subtitle alone is not the book.
    expect(found("Letters, 1911 to 1914", "Odile Brandt", library)).toBeNull();
  });

  it("prefers the book of the very same title to one that only shares its start", () => {
    const both = [...library, book("salt-notes", "The Salt Road: The Author's Notes", "Maren Voss")];
    expect(found("The Salt Road", "Maren Voss", both)).toBe("salt");
    expect(found("The Salt Road: The Author's Notes", "Voss, Maren", both)).toBe("salt-notes");
  });

  it("guesses at nothing when two books fit", () => {
    const twice = [...library, book("salt-pdf", "The Salt Road", "Maren Voss")];
    expect(found("The Salt Road", "Maren Voss", twice)).toBe("ambiguous");
    const volumes = [book("one", "Tidewrack: The Outer Banks", "Maren Voss"), book("two", "Tidewrack: The Inner Sound", "Maren Voss")];
    expect(found("Tidewrack", "Maren Voss", volumes)).toBe("ambiguous");
    // The author settles it when only one of them is hers.
    const namesakes = [book("hers", "Low Water", "Maren Voss"), book("his", "Low Water", "Tomas Reyes")];
    expect(found("Low Water", "Voss, Maren", namesakes)).toBe("hers");
    expect(found("Low Water", null, namesakes)).toBe("ambiguous");
  });

  it("compares a title in another alphabet by its own letters", () => {
    const shelf = [book("ru1", "Солёная дорога", "Марен Восс"), book("ru2", "Солёная дорога 2", "Марен Восс"), book("ja", "塩の道", null)];
    expect(found("Солёная дорога", "Марен Восс", shelf)).toBe("ru1");
    expect(found("СОЛЁНАЯ ДОРОГА 2", null, shelf)).toBe("ru2");
    expect(found("Тихая вода 2", null, shelf)).toBeNull();
    expect(found("塩の道", "誰か", shelf)).toBe("ja");
    expect(found("海の道", null, shelf)).toBeNull();
  });

  it("finds nothing for a title with no letters, or in an empty library", () => {
    expect(found("...", null, library)).toBeNull();
    expect(found("", null, [book("blank", "")])).toBeNull();
    expect(found("The Salt Road", "Maren Voss", [])).toBeNull();
  });
});

describe("matching a file's books", () => {
  const library = [book("salt", "The Salt Road", "Maren Voss"), book("low", "Low Water", "Maren Voss"), book("low-2", "Low Water", "Maren Voss")];

  it("says which were found, and which were not and why", () => {
    const { matched, missed } = matchClippings(
      [
        kindle("The Salt Road", "Voss, Maren", clip("One.", 1), clip("Two.", 2)),
        kindle("A Book Never Bought", "Ines Okafor", clip("Three.", 3)),
        kindle("Low Water", "Voss, Maren", clip("Four.", 4), clip("Five.", 5), clip("Six.", 6))
      ],
      library
    );
    expect(matched.map((match) => [match.book.id, match.clippings.map((item) => item.text)])).toEqual([["salt", ["One.", "Two."]]]);
    expect(missed).toEqual([
      { title: "A Book Never Bought", author: "Ines Okafor", count: 1, ambiguous: false },
      { title: "Low Water", author: "Voss, Maren", count: 3, ambiguous: true }
    ]);
  });

  it("puts two Kindle editions of one book together", () => {
    const { matched, missed } = matchClippings(
      [kindle("The Salt Road", "Voss, Maren", clip("One.", 1)), kindle("The Salt Road (The Tide Cycle Book 1)", "Maren Voss", clip("Two.", 2))],
      library
    );
    expect(missed).toEqual([]);
    expect(matched).toHaveLength(1);
    expect(matched[0].clippings.map((item) => item.text)).toEqual(["One.", "Two."]);
  });
});

describe("the highlights clippings become", () => {
  const NOW = new Date(2026, 9, 7, 12, 0, 0).getTime();

  it("are highlights at a Kindle place, yellow, filed by page or location", () => {
    const [paged, located, nowhere] = kindleAnnotations(
      "salt",
      [
        clip("The tide kept its own ledger.", 123, { locationEnd: 125, page: "12", note: "Like the harbour master." }),
        clip("Nobody asked the gulls.", 300),
        clip("Die Flut führte ihr eigenes Buch.")
      ],
      NOW
    );
    expect(paged).toEqual({
      id: paged.id,
      bookId: "salt",
      kind: "highlight",
      cfi: "kindle:123",
      text: "The tide kept its own ledger.",
      note: "Like the harbour master.",
      color: "yellow",
      chapter: "Page 12",
      createdAt: undefined
    });
    expect(paged.id).toMatch(/^kindle-[0-9a-f]{16}$/);
    expect([located.cfi, located.chapter]).toEqual(["kindle:300", "Location 300"]);
    expect(nowhere.cfi).toMatch(/^kindle:h[0-9a-f]{8}$/);
    expect(nowhere.chapter).toBe("Kindle");
    expect([paged, located, nowhere].every((item) => isKindlePlace(item.cfi))).toBe(true);
  });

  it("keep the Kindle's date, read by this device's clock", () => {
    const [dated, undated, tomorrow, nonsense] = kindleAnnotations(
      "salt",
      [
        clip("One.", 1, { addedAt: "2024-03-04T22:15:32" }),
        clip("Two.", 2),
        clip("Three.", 3, { addedAt: "2026-10-08T12:00:00" }),
        clip("Four.", 4, { addedAt: "sometime" })
      ],
      NOW
    );
    expect(dated.createdAt).toBe(new Date(2024, 2, 4, 22, 15, 32).toISOString());
    expect(undated.createdAt).toBeUndefined();
    // A Kindle whose clock ran ahead: dated when it is imported instead.
    expect(tomorrow.createdAt).toBeUndefined();
    expect(nonsense.createdAt).toBeUndefined();
  });

  it("have the same id every time, from the book, the place and the words", () => {
    const one = clip("The tide kept its own ledger.", 123);
    expect(kindleId("salt", one)).toBe(kindleId("salt", { ...one }));
    // Not from what may be edited since, on the Kindle or here.
    expect(kindleId("salt", { ...one, note: "A note.", page: "12", addedAt: "2024-03-04T22:15:32", locationEnd: 130 })).toBe(kindleId("salt", one));
    expect(kindleId("ember", one)).not.toBe(kindleId("salt", one));
    expect(kindleId("salt", clip("The tide kept its own ledger.", 124))).not.toBe(kindleId("salt", one));
    expect(kindleId("salt", clip("The tide kept its own ledger, and more.", 123))).not.toBe(kindleId("salt", one));
    expect(kindleId("salt", clip("The tide kept its own ledger."))).not.toBe(kindleId("salt", one));
    // What sits either side of the joins cannot be shuffled into the same id.
    expect(kindleId("a", clip("b", 1))).not.toBe(kindleId("a\nkindle:1\nb", clip("", 1)));
  });

  it("are each made once, and a note with no passage has no words", () => {
    const made = kindleAnnotations("salt", [
      clip("The tide kept its own ledger.", 123),
      clip("The tide kept its own ledger.", 123, { note: "The same one, from another edition." }),
      clip("", 500, { note: "Who is the pilot?" })
    ]);
    expect(made).toHaveLength(2);
    expect(made[0].note).toBe("The same one, from another edition.");
    expect(made[1]).toMatchObject({ cfi: "kindle:500", text: null, note: "Who is the pilot?", chapter: "Location 500" });
  });
});

describe("planning an import", () => {
  const RULE = "==========";
  const entry = (title: string, heading: string, body = "") => [title, heading, "", body, RULE].join("\n");
  const at = (where: string) => `- Your Highlight on ${where} | Added on Monday, March 4, 2024 10:15:32 PM`;
  const FILE = `${[
    entry("The Salt Road (Voss, Maren)", at("page 12 | Location 123-125"), "The tide kept its own ledger."),
    entry("The Salt Road (Voss, Maren)", "- Your Note on page 12 | Location 125 | Added on Monday, March 4, 2024 10:16:00 PM", "Like the harbour master."),
    entry("The Salt Road (Voss, Maren)", at("Location 300-301"), "Nobody asked the gulls."),
    entry("Emberfall (The Tide Cycle Book 2) (Voss, Maren)", at("Location 40-41"), "Ash on the water."),
    entry("A Book Never Bought (Ines Okafor)", at("Location 5-6"), "Left on the Kindle."),
    entry("Low Water (Voss, Maren)", at("Location 7-8"), "Which copy?")
  ].join("\n")}\n`;
  const library = [
    book("salt", "The Salt Road", "Maren Voss"),
    book("ember", "Emberfall", "Maren Voss"),
    book("low", "Low Water", "Maren Voss"),
    book("low-2", "Low Water", "Maren Voss"),
    book("other", "Something Else Entirely", "Tomas Reyes")
  ];
  /** A library's annotations, as the service lists them by book. */
  const shelf = () => {
    const ids = new Map<string, string[]>();
    return {
      ids,
      idsIn: async (bookId: string) => ids.get(bookId) ?? [],
      add: (items: Array<{ id: string; bookId: string }>) => items.forEach((item) => ids.set(item.bookId, [...(ids.get(item.bookId) ?? []), item.id]))
    };
  };

  it("adds every highlight of the books it finds, and names those it does not", async () => {
    const plan = await planKindleImport(FILE, library, shelf().idsIn);
    expect(plan.fresh.map((item) => [item.bookId, item.cfi, item.text, item.note])).toEqual([
      ["salt", "kindle:123", "The tide kept its own ledger.", "Like the harbour master."],
      ["salt", "kindle:300", "Nobody asked the gulls.", null],
      ["ember", "kindle:40", "Ash on the water.", null]
    ]);
    expect([plan.books, plan.had]).toEqual([2, 0]);
    expect(plan.missed.map((miss) => [miss.title, miss.ambiguous])).toEqual([
      ["A Book Never Bought", false],
      ["Low Water", true]
    ]);
    expect(planLine(plan)).toBe("3 highlights for 2 books");
    expect(missedTitles(plan.missed)).toBe("A Book Never Bought (Ines Okafor)\nLow Water (Voss, Maren): more than one book it could be");
  });

  it("adds nothing the second time, whatever order the file is in", async () => {
    const kept = shelf();
    const first = await planKindleImport(FILE, library, kept.idsIn);
    kept.add(first.fresh);
    const again = await planKindleImport(FILE, library, kept.idsIn);
    expect(again.fresh).toEqual([]);
    expect([again.books, again.had]).toEqual([0, 3]);
    expect(planLine(again)).toBe("Nothing new");
    // The same clippings as the Kindle would write them from the other end.
    const turned = `${FILE.trimEnd().split(`${RULE}\n`).reverse().join(`${RULE}\n`)}\n${RULE}\n`.replace(`${RULE}\n${RULE}`, RULE);
    expect(parseClippings(turned).flatMap((read) => read.clippings)).toHaveLength(5);
    expect((await planKindleImport(turned, library, kept.idsIn)).fresh).toEqual([]);
  });

  it("adds only what is new when the Kindle has been read on since", async () => {
    const kept = shelf();
    kept.add((await planKindleImport(FILE, library, kept.idsIn)).fresh);
    const more = `${FILE}${entry("Emberfall (The Tide Cycle Book 2) (Voss, Maren)", at("Location 90-91"), "The bell under the sand.")}\n`;
    const plan = await planKindleImport(more, library, kept.idsIn);
    expect(plan.fresh.map((item) => item.text)).toEqual(["The bell under the sand."]);
    expect([plan.books, plan.had]).toEqual([1, 3]);
    expect(planLine(plan)).toBe("1 highlight for 1 book");
  });

  it("says so when there is nothing to bring", async () => {
    const none = await planKindleImport(FILE, [book("other", "Something Else Entirely", "Tomas Reyes")], shelf().idsIn);
    expect(none.fresh).toEqual([]);
    expect(none.missed).toHaveLength(4);
    expect(planLine(none)).toBe("Nothing to import");
    const empty = await planKindleImport("", library, shelf().idsIn);
    expect(empty).toEqual({ fresh: [], books: 0, had: 0, missed: [] });
    expect(planLine(empty)).toBe("No highlights in that file");
  });

  it("goes in through the service once, with the Kindle's date, and changes nothing after", async () => {
    // The preview's store (annotationService keeps annotations there outside the app).
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key)
    });
    try {
      const idsIn = async (bookId: string) => (await annotationService.list(bookId)).map((item) => item.id);
      const first = await planKindleImport(FILE, library, idsIn);
      for (const item of first.fresh) {
        await annotationService.save(item);
      }
      const salt = await annotationService.list("salt");
      expect(salt.map((item) => [item.cfi, item.kind, item.createdAt])).toEqual([
        ["kindle:123", "highlight", new Date(2024, 2, 4, 22, 15, 32).toISOString()],
        ["kindle:300", "highlight", new Date(2024, 2, 4, 22, 15, 32).toISOString()]
      ]);
      expect(await annotationService.highlightCounts()).toEqual([
        { bookId: "salt", count: 2 },
        { bookId: "ember", count: 1 }
      ]);
      // A note written here since, and a colour changed.
      const { createdAt: _c, updatedAt: _u, deletedAt: _d, ...edited } = salt[0];
      await annotationService.save({ ...edited, note: "Edited in Leaflet.", color: "green" });
      const before = stored.get("leaflet.annotations.preview");

      const again = await planKindleImport(FILE, library, idsIn);
      expect(again.fresh).toEqual([]);
      for (const item of again.fresh) {
        await annotationService.save(item);
      }
      expect(stored.get("leaflet.annotations.preview")).toBe(before);
      const kept = (await annotationService.list("salt")).find((item) => item.cfi === "kindle:123");
      expect([kept?.note, kept?.color, kept?.createdAt]).toEqual(["Edited in Leaflet.", "green", new Date(2024, 2, 4, 22, 15, 32).toISOString()]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("counts the titles a tooltip has no room for", () => {
    const missed = Array.from({ length: 30 }, (_, index) => ({ title: `Book ${index + 1}`, author: null, count: 1, ambiguous: false }));
    const lines = missedTitles(missed).split("\n");
    expect(lines).toHaveLength(25);
    expect(lines[0]).toBe("Book 1");
    expect(lines[24]).toBe("and 6 more");
  });
});
