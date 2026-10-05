import { describe, expect, it } from "vitest";
import {
  bookOfRow,
  bookOfSection,
  bookStandings,
  crossedStoryEnd,
  findInnerBooks,
  fractionOfBook,
  gapFollows,
  isNumberedDivision,
  labelInBook,
  listRows,
  storyGaps,
  tocDepths,
  type ContentsRow
} from "./innerBooks";

/**
 * Made-up contents, built as a list of rows and the size of each section.
 * `add(label, depth, bytes)` opens a new section; `anchor(label, depth)` is
 * another entry in the section just opened.
 */
const build = () => {
  const rows: ContentsRow[] = [];
  const bytes: number[] = [];
  const api = {
    rows,
    bytes,
    add: (label: string, depth = 0, size = 300) => {
      bytes.push(size);
      rows.push({ label, spine: bytes.length - 1, depth });
      return api;
    },
    anchor: (label: string, depth = 0) => {
      rows.push({ label, spine: bytes.length - 1, depth });
      return api;
    },
    /** A section the contents do not list. */
    unlisted: (size = 300) => {
      bytes.push(size);
      return api;
    }
  };
  return api;
};

const NAMES = ["ANNA", "BORIS", "CLARA", "DMITRI"];

/** A novel as a boxed set nests it: its own entry on its cover, front matter, a prologue, named chapters, appendices. */
const nestedNovel = (set: ReturnType<typeof build>, title: string, chapters: number, epilogue = false) => {
  set.add(title, 0).anchor("COVER", 1).add("TITLE PAGE", 1).add("COPYRIGHT", 1).add("MAPS", 1).add("PROLOGUE", 1, 9000);
  for (let index = 0; index < chapters; index += 1) {
    set.add(NAMES[index % NAMES.length], 1, 10000);
  }
  if (epilogue) {
    set.add("EPILOGUE", 1, 7000);
  }
  set.add("APPENDIX", 1, 6000).anchor("HOUSE OF THE NORTH", 2).anchor("HOUSE OF THE SOUTH", 2).add("ACKNOWLEDGMENTS", 1, 400);
};

const boxedSet = () => {
  const set = build();
  set.add("COVER").add("TITLE PAGE").add("CONTENTS");
  nestedNovel(set, "THE FIRST NOVEL", 10);
  nestedNovel(set, "THE SECOND NOVEL", 8);
  nestedNovel(set, "THE THIRD NOVEL", 12, true);
  set.add("ABOUT THE AUTHOR").add("EXCERPT FROM THE FOURTH", 0, 300).unlisted(8000);
  return set;
};

describe("the books inside a boxed set with nested contents", () => {
  const set = boxedSet();
  const books = findInnerBooks(set.rows, set.bytes);

  it("finds each novel, its sections and its story", () => {
    expect(books.map((book) => book.label)).toEqual(["THE FIRST NOVEL", "THE SECOND NOVEL", "THE THIRD NOVEL"]);
    const [first, second, third] = books;
    expect(set.rows[first.entry].label).toBe("THE FIRST NOVEL");
    expect(first.first).toBe(3);
    expect(second.first).toBe(first.last + 1);
    // The story is the prologue to the last chapter: not the cover, not the appendix.
    expect(set.rows.find((row) => row.spine === first.storyLo && row.depth === 1)?.label).toBe("PROLOGUE");
    expect(set.bytes[first.storyHi]).toBe(10000);
    expect(set.rows.find((row) => row.spine === first.storyHi + 1)?.label).toBe("APPENDIX");
    expect(set.rows.find((row) => row.spine === third.storyHi)?.label).toBe("EPILOGUE");
    // The last one stops before the set's own closing pages.
    expect(set.rows.find((row) => row.spine === third.last + 1)?.label).toBe("ABOUT THE AUTHOR");
  });

  it("knows which book a section and a row are in", () => {
    expect(bookOfSection(books, 0)).toBe(-1);
    expect(bookOfSection(books, books[1].storyLo)).toBe(1);
    expect(bookOfSection(books, set.bytes.length - 1)).toBe(-1);
    expect(bookOfRow(books, 0)).toBe(-1);
    expect(bookOfRow(books, books[2].entry + 3)).toBe(2);
  });

  it("lays the list out: a header, quiet front matter, chapters, and what follows the end", () => {
    const list = listRows(set.rows, books);
    const ofFirst = list.filter((row) => row.book === 0);
    expect(ofFirst[0].kind).toBe("header");
    expect(ofFirst.slice(1, 5).map((row) => [set.rows[row.entry].label, row.kind])).toEqual([
      ["COVER", "front"],
      ["TITLE PAGE", "front"],
      ["COPYRIGHT", "front"],
      ["MAPS", "front"]
    ]);
    expect(ofFirst.filter((row) => row.kind === "chapter")).toHaveLength(11);
    expect(ofFirst.filter((row) => row.kind === "back").map((row) => [set.rows[row.entry].label, row.depth])).toEqual([
      ["APPENDIX", 0],
      ["HOUSE OF THE NORTH", 1],
      ["HOUSE OF THE SOUTH", 1],
      ["ACKNOWLEDGMENTS", 0]
    ]);
    expect(list.filter((row) => row.kind === "loose").map((row) => set.rows[row.entry].label)).toEqual(["COVER", "TITLE PAGE", "CONTENTS", "ABOUT THE AUTHOR", "EXCERPT FROM THE FOURTH"]);
  });

  it("says how each book stands from where the reading has got to", () => {
    const [first, second] = books;
    const middle = { section: second.storyLo + 4, within: 0.5 };
    const standings = bookStandings(books, set.bytes, middle);
    expect(standings.map((standing) => standing.state)).toEqual(["read", "reading", "unread"]);
    // The prologue and three chapters and a half of 9000 + 8 x 10000.
    expect(standings[1].fraction).toBeCloseTo((9000 + 3.5 * 10000) / 89000);
    expect(fractionOfBook(second, set.bytes, middle)).toBeCloseTo(standings[1].fraction);
    // On the second one's cover: begun, nothing read. In the first one's appendix: read.
    expect(bookStandings(books, set.bytes, { section: second.first, within: 0 })[1]).toEqual({ state: "reading", fraction: 0 });
    expect(bookStandings(books, set.bytes, { section: first.storyHi + 1, within: 0.2 })[0].state).toBe("read");
    expect(bookStandings(books, set.bytes, { section: first.storyHi, within: 1 })[0].state).toBe("read");
    expect(bookStandings(books, set.bytes, null).every((standing) => standing.state === "unread")).toBe(true);
    expect(bookStandings(books, set.bytes, middle, true).every((standing) => standing.state === "read")).toBe(true);
  });

  it("knows when the reading has just passed the end of one of the novels", () => {
    const [first, second, third] = books;
    // From the first novel's last chapter into its appendix, or straight to the second one's cover or prologue.
    expect(crossedStoryEnd(books, first.storyHi, first.storyHi + 1)).toBe(0);
    expect(crossedStoryEnd(books, first.storyHi, second.first)).toBe(0);
    expect(crossedStoryEnd(books, first.storyHi, second.storyLo)).toBe(0);
    expect(crossedStoryEnd(books, third.storyHi, third.storyHi + 1)).toBe(2);
    // Not a move within the story, a look back, a jump from elsewhere or to far away, or the first look at a place.
    expect(crossedStoryEnd(books, first.storyHi - 1, first.storyHi)).toBe(-1);
    expect(crossedStoryEnd(books, first.storyHi + 1, first.storyHi)).toBe(-1);
    expect(crossedStoryEnd(books, first.storyLo + 2, first.storyHi + 1)).toBe(-1);
    expect(crossedStoryEnd(books, first.storyHi, second.storyLo + 3)).toBe(-1);
    expect(crossedStoryEnd(books, null, first.storyHi + 1)).toBe(-1);
    expect(crossedStoryEnd([], 3, 4)).toBe(-1);
  });

  it("finds the stretches between the stories", () => {
    const gaps = storyGaps(books, set.bytes.length - 1);
    expect(gaps).toHaveLength(4);
    expect(gaps[0]).toEqual({ from: 0, to: books[0].storyLo - 1, before: -1, after: 0 });
    expect(gaps[1]).toEqual({ from: books[0].storyHi + 1, to: books[1].storyLo - 1, before: 0, after: 1 });
    expect(gaps[3]).toEqual({ from: books[2].storyHi + 1, to: set.bytes.length - 1, before: 2, after: -1 });
  });
});

describe("what is not a set", () => {
  it("is a novel in numbered parts", () => {
    const novel = build();
    novel.add("Cover").add("Title Page").add("Maps").add("Prologue", 0, 5000);
    for (const part of ["Part One: The Survivor", "Part Two: Rebels", "Part Three: Children"]) {
      novel.add(part, 0, 500);
      for (let index = 0; index < 8; index += 1) {
        novel.add(`Chapter ${index + 1}`, 1, 9000);
      }
    }
    novel.add("Epilogue", 0, 4000).add("Ars Arcanum", 0, 3000).add("About the Author").add("Copyright");
    expect(findInnerBooks(novel.rows, novel.bytes)).toEqual([]);
  });

  it("is a novel whose parts are called books", () => {
    const novel = build();
    novel.add("Cover").add("Title Page").add("Copyright");
    for (const part of ["Book One: The Planet", "Book Two: The Tribe", "Book Three: The Prophet"]) {
      novel.add(part, 0, 400);
      for (let index = 0; index < 12; index += 1) {
        novel.add(`Chapter ${index + 1}`, 1, 9000);
      }
    }
    novel.add("Appendix I: The Ecology", 0, 5000).add("About the Author");
    expect(findInnerBooks(novel.rows, novel.bytes)).toEqual([]);
    expect(isNumberedDivision("Book Two: The Tribe")).toBe(true);
    expect(isNumberedDivision("PART IV")).toBe(true);
    expect(isNumberedDivision("Volume 3")).toBe(true);
    expect(isNumberedDivision("A Storm of Swords")).toBe(false);
    expect(isNumberedDivision("Book of the Dead")).toBe(false);
    expect(isNumberedDivision("Partners")).toBe(false);
  });

  it("is a flat list of chapters, one group of chapters, or nothing at all", () => {
    const flat = build();
    flat.add("Title Page").add("Copyright");
    for (let index = 0; index < 30; index += 1) {
      flat.add(`Chapter ${index + 1}`, 0, 8000);
    }
    flat.add("About the Author").add("Copyright");
    expect(findInnerBooks(flat.rows, flat.bytes)).toEqual([]);
    const one = build();
    one.add("Cover").add("The Only Novel", 0, 300);
    for (let index = 0; index < 9; index += 1) {
      one.add(NAMES[index % 4], 1, 8000);
    }
    one.add("Notes", 0, 2000).anchor("To chapter one", 1).anchor("To chapter two", 1).anchor("To chapter three", 1);
    expect(findInnerBooks(one.rows, one.bytes)).toEqual([]);
    expect(findInnerBooks([], [])).toEqual([]);
  });
});

describe("named groups that are not books", () => {
  it("is one text in several versions, each with an introduction of its own", () => {
    const text = build();
    text.add("Title page");
    for (const version of ["Comparative Version", "Modern Version"]) {
      text.add(version, 0, 300).add("Introduction", 1, 2000);
      for (const part of ["I. The First Part", "II. The Second Part", "III. The Third Part"]) {
        text.add(part, 1, 9000);
      }
    }
    text.add("Original Version", 0, 20000);
    expect(findInnerBooks(text.rows, text.bytes)).toEqual([]);
  });

  it("is a novel whose parts have names and no numbers", () => {
    const novel = build();
    novel.add("Cover").add("Title Page").add("Prologue", 0, 4000);
    for (const part of ["The Survivor", "Rebels Beneath a Sky of Ash", "Children of a Bleeding Sun"]) {
      novel.add(part, 0, 400);
      for (let index = 0; index < 8; index += 1) {
        novel.add(`Chapter ${index + 1}`, 1, 9000);
      }
    }
    novel.add("Epilogue", 0, 4000);
    expect(findInnerBooks(novel.rows, novel.bytes)).toEqual([]);
  });

  it("is a set as soon as half its groups carry a cover, a title page or an appendix of their own", () => {
    const set = build();
    for (const [title, own] of [
      ["The Hound", true],
      ["The Valley", false]
    ] as const) {
      set.add(title, 0, 300);
      if (own) {
        set.add("Title Page", 1);
      }
      for (let index = 0; index < 6; index += 1) {
        set.add(`Chapter ${index + 1}`, 1, 9000);
      }
    }
    expect(findInnerBooks(set.rows, set.bytes).map((book) => book.label)).toEqual(["The Hound", "The Valley"]);
  });
});

describe("numbered books that are books", () => {
  it("counts a numbered entry with a title page of its own", () => {
    const set = build();
    for (const title of ["Book One: The Gun", "Book Two: The Door"]) {
      set.add(title, 0).add("Title Page", 1).add("Copyright", 1);
      for (let index = 0; index < 6; index += 1) {
        set.add(`Chapter ${index + 1}`, 1, 9000);
      }
    }
    expect(findInnerBooks(set.rows, set.bytes).map((book) => book.label)).toEqual(["Book One: The Gun", "Book Two: The Door"]);
  });
});

describe("books the contents say are books", () => {
  it("takes a flagged entry for a book whatever it is called (a chapter list made for a set with none)", () => {
    const set = build();
    for (const title of ["Book One", "Book Two", "Book Three"]) {
      set.add(title, 0, 400);
      set.rows[set.rows.length - 1].book = true;
      for (let index = 0; index < 5; index += 1) {
        set.add(`Chapter ${index + 1}`, 1, 9000);
      }
    }
    const books = findInnerBooks(set.rows, set.bytes);
    expect(books.map((book) => book.label)).toEqual(["Book One", "Book Two", "Book Three"]);
    expect(set.rows.find((row) => row.spine === books[1].storyLo)?.label).toBe("Chapter 1");
    // The same contents without the flag are the parts of one novel.
    expect(findInnerBooks(set.rows.map((row) => ({ ...row, book: undefined })), set.bytes)).toEqual([]);
  });
});

describe("a set with flat contents", () => {
  const flatNovel = (set: ReturnType<typeof build>, title: string | null, chapters: number) => {
    if (title) {
      set.add(title, 0);
      set.anchor("Cover", 0);
    } else {
      set.add("Cover", 0);
    }
    set.add("Title Page").add("Copyright").add("Dedication").add("Prologue", 0, 6000);
    for (let index = 0; index < chapters; index += 1) {
      set.add(NAMES[index % 4], 0, 9000);
    }
    set.add("Appendix", 0, 4000).add("Acknowledgments", 0, 300);
  };

  it("finds the books by their title pages, named by the entry before each", () => {
    const set = build();
    set.add("Cover").add("Title Page").add("Contents");
    flatNovel(set, "The First Novel", 8);
    flatNovel(set, "The Second Novel", 10);
    set.add("About the Author");
    const books = findInnerBooks(set.rows, set.bytes);
    expect(books.map((book) => book.label)).toEqual(["The First Novel", "The Second Novel"]);
    expect(set.rows[books[0].entry].label).toBe("The First Novel");
    expect(set.rows.find((row) => row.spine === books[0].storyLo)?.label).toBe("Prologue");
    expect(set.bytes[books[0].storyHi]).toBe(9000);
    // The first one ends with its acknowledgments; the second opens on its own cover.
    expect(set.rows[books[0].lastRow].label).toBe("Acknowledgments");
    expect(books[1].first).toBe(books[0].last + 1);
    const list = listRows(set.rows, books);
    expect(list.filter((row) => row.kind === "header")).toHaveLength(2);
    expect(list.slice(0, 3).every((row) => row.kind === "loose")).toBe(true);
  });

  it("numbers the books when nothing names them", () => {
    const set = build();
    flatNovel(set, null, 8);
    flatNovel(set, null, 8);
    const books = findInnerBooks(set.rows, set.bytes);
    expect(books.map((book) => [book.label, book.entry])).toEqual([
      ["Book 1", -1],
      ["Book 2", -1]
    ]);
    // The second opens at its cover, not at the first one's appendix.
    expect(set.rows[books[1].firstRow].label).toBe("Cover");
    expect(set.rows[books[0].lastRow].label).toBe("Acknowledgments");
  });

  it("does not take a preview with a title page for a book", () => {
    const set = build();
    set.add("Cover").add("Title Page").add("Copyright");
    for (let index = 0; index < 30; index += 1) {
      set.add(`Chapter ${index + 1}`, 0, 9000);
    }
    set.add("Title Page").add("Copyright").add("Chapter 1", 0, 6000);
    expect(findInnerBooks(set.rows, set.bytes)).toEqual([]);
  });
});

describe("small things", () => {
  it("reads how deep each entry of a tree is, in list order", () => {
    expect(tocDepths([{ label: "a", href: "a", subitems: [{ label: "b", href: "b", subitems: [{ label: "c", href: "c" }] }] }, { label: "d", href: "d" }])).toEqual([0, 1, 2, 0]);
  });

  it("names a chapter with its book", () => {
    expect(labelInBook("A CLASH OF KINGS", "TYRION")).toBe("A CLASH OF KINGS · TYRION");
    expect(labelInBook("A CLASH OF KINGS", "A Clash of Kings")).toBe("A Clash of Kings");
    expect(labelInBook(null, "TYRION")).toBe("TYRION");
    expect(labelInBook("A CLASH OF KINGS", "")).toBe("A CLASH OF KINGS");
  });

  it("follows the reader between two stories only when the reading has got there", () => {
    // A gap from 45.5% to 46.7% of the set.
    expect(gapFollows(0.4548, 0.455, 0.467)).toBe(true);
    expect(gapFollows(0.46, 0.455, 0.467)).toBe(true);
    expect(gapFollows(0.4675, 0.455, 0.467)).toBe(true);
    // A look at the next book's map from forty chapters into it, or from the book before.
    expect(gapFollows(0.6, 0.455, 0.467)).toBe(false);
    expect(gapFollows(0.3, 0.455, 0.467)).toBe(false);
    expect(gapFollows(Number.NaN, 0, 0.002)).toBe(true);
  });
});
