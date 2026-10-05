import { describe, expect, it } from "vitest";
import { beforeStory, chapterEndWithin, chapterOnPage, chapterPageRange, chapterTail, earlierEntry, entryAtShare, listedAgain, nextChapterEntry, pagesOfChapter, previousChapterEntry, type ChapterStart } from "./chapterSpan";

// A novel of three files and seven chapters, the cover first. File 1 opens
// with the book's own list of chapters; file 2 opens with the tail of chapter
// three; a small unlisted file sits between them.
const novel: ChapterStart[] = [
  { spine: 0, within: 0 }, // 0 Cover
  { spine: 1, within: 0.02 }, // 1 One
  { spine: 1, within: 0.4 }, // 2 Two
  { spine: 1, within: 0.8 }, // 3 Three
  { spine: 3, within: 0.2 }, // 4 Four
  { spine: 3, within: 0.7 }, // 5 Five
  { spine: 4, within: 0 }, // 6 Six (opens its file)
  { spine: 4, within: 0.5 } // 7 Seven
];

// An ordinary book: a file for each chapter.
const plain: ChapterStart[] = [0, 1, 2, 3, 5].map((spine) => ({ spine, within: 0 }));

describe("next chapter", () => {
  it("goes to the next heading in the same file", () => {
    expect(nextChapterEntry(novel, 1, 1)).toBe(2);
    expect(nextChapterEntry(novel, 1, 2)).toBe(3);
  });

  it("goes past the rest of a chapter that runs into the next file", () => {
    // From chapter three: not the small file between, nor the top of file 3 (still chapter three), but chapter four.
    expect(nextChapterEntry(novel, 1, 3)).toBe(4);
    expect(nextChapterEntry(novel, 2, 3)).toBe(4);
  });

  it("is the next file, as before, when the next entry opens one", () => {
    expect(nextChapterEntry(novel, 3, 5)).toBeNull();
    expect(nextChapterEntry(plain, 1, 1)).toBeNull();
    expect(nextChapterEntry(plain, 4, 3)).toBeNull();
    expect(nextChapterEntry(novel, 4, 7)).toBeNull();
  });

  it("starts from before the first entry", () => {
    expect(nextChapterEntry(novel, 0, -1)).toBeNull();
    expect(nextChapterEntry([{ spine: 0, within: 0.3 }], 0, -1)).toBe(0);
  });
});

describe("previous chapter", () => {
  it("goes to the heading before, in this file or the one before", () => {
    expect(previousChapterEntry(novel, 1, 3)).toBe(2);
    expect(previousChapterEntry(novel, 3, 4)).toBe(3);
    expect(previousChapterEntry(novel, 4, 7)).toBe(6);
    // From a chapter that opens its file, back to the last heading inside the file before.
    expect(previousChapterEntry(novel, 4, 6)).toBe(5);
  });

  it("is the previous file, as before, in an ordinary book", () => {
    expect(previousChapterEntry(plain, 2, 2)).toBeNull();
    expect(previousChapterEntry(plain, 0, -1)).toBeNull();
  });

  it("goes to the top of the file from its first chapter when nothing is listed before it", () => {
    expect(previousChapterEntry([{ spine: 0, within: 0.1 }, { spine: 0, within: 0.6 }], 0, 0)).toBe("top");
    expect(previousChapterEntry(novel, 1, 1)).toBe(0);
  });
});

describe("where a chapter ends in its file", () => {
  it("is the next heading further down", () => {
    expect(chapterEndWithin(novel, 1, 1, 0.1)).toBeCloseTo(0.4);
    expect(chapterEndWithin(novel, 1, 2, 0.5)).toBeCloseTo(0.8);
    // The tail of chapter three, at the top of file 3: it ends where chapter four starts.
    expect(chapterEndWithin(novel, 3, 3, 0.05)).toBeCloseTo(0.2);
  });

  it("is the end of the file otherwise", () => {
    expect(chapterEndWithin(novel, 1, 3, 0.9)).toBeNull();
    expect(chapterEndWithin(plain, 2, 2, 0.3)).toBeNull();
  });
});

describe("a chapter that runs into the next file", () => {
  it("has the head of that file, down to the next heading", () => {
    // Chapter three: the end of file 1, the small file 2, and the first fifth of file 3.
    expect(chapterTail(novel, 1, 3)).toEqual({ section: 3, within: 0.2 });
    expect(chapterTail(novel, 2, 3)).toEqual({ section: 3, within: 0.2 });
  });

  it("has none when the next chapter opens its file, or starts further down this one", () => {
    expect(chapterTail(novel, 3, 5)).toBeNull();
    expect(chapterTail(novel, 1, 1)).toBeNull();
    expect(chapterTail(plain, 1, 1)).toBeNull();
    expect(chapterTail(novel, 4, 7)).toBeNull();
  });
});

describe("the entry a place is under, by shares", () => {
  it("follows the headings inside a file", () => {
    expect(entryAtShare(novel, 1, 0.01)).toBe(0);
    expect(entryAtShare(novel, 1, 0.02)).toBe(1);
    expect(entryAtShare(novel, 1, 0.5)).toBe(2);
    expect(entryAtShare(novel, 2, 0.5)).toBe(3);
    expect(entryAtShare(novel, 3, 0.1)).toBe(3);
    expect(entryAtShare(novel, 3, 0.9)).toBe(5);
    expect(entryAtShare(novel, 4, 0)).toBe(6);
  });

  it("is -1 before the first entry, and passes an entry that points at the end of the book", () => {
    expect(entryAtShare([{ spine: 2, within: 0 }], 1, 0.5)).toBe(-1);
    // A contents whose first entry ("Cover") leads to the last file.
    expect(entryAtShare([{ spine: 9, within: 0 }, { spine: 1, within: 0 }, { spine: 2, within: 0 }], 2, 0.5)).toBe(2);
  });
});

describe("a file listed twice in a row", () => {
  it("is found, and only when the two are neighbours", () => {
    expect(listedAgain(["title.html", "title.html", "copyright.html", "c1.html"])).toEqual([1]);
    expect(listedAgain(["a.html", "a.html", "a.html", "b.html"])).toEqual([1, 2]);
    // The cover again at the end of the book is a different place.
    expect(listedAgain(["cover.html", "c1.html", "cover.html"])).toEqual([]);
    expect(listedAgain(["", ""])).toEqual([]);
    expect(listedAgain([])).toEqual([]);
  });
});

describe("before the story", () => {
  // The story is sections 1 to 4; the contents are Cover, Contents, Chapter 1 (part-way down section 1), ...
  const story = { lo: 1, firstChapter: 2, firstChapterSection: 1 };

  it("is the cover, and the page of the first file that comes before chapter one", () => {
    expect(beforeStory({ section: 0, entry: 0 }, story)).toBe(true);
    expect(beforeStory({ section: 1, entry: 1 }, story)).toBe(true);
    expect(beforeStory({ section: 1, entry: -1 }, story)).toBe(true);
  });

  it("is not chapter one, nor anything after", () => {
    expect(beforeStory({ section: 1, entry: 2 }, story)).toBe(false);
    expect(beforeStory({ section: 3, entry: 9 }, story)).toBe(false);
    // An unlisted section in the middle of the story, under an early entry by accident of the contents.
    expect(beforeStory({ section: 2, entry: 1 }, story)).toBe(false);
  });

  it("goes by the sections alone when no entry reads as a chapter", () => {
    expect(beforeStory({ section: 2, entry: 0 }, { lo: 3, firstChapter: -1, firstChapterSection: undefined })).toBe(true);
    expect(beforeStory({ section: 3, entry: 0 }, { lo: 3, firstChapter: -1, firstChapterSection: undefined })).toBe(false);
  });
});

describe("the pages of a chapter that shares its file", () => {
  // A file of 181 pages: chapters start on pages 5, 60 (at the top), 152 and 162 (part-way down).
  const starts = [
    { page: 5, atTop: false, entry: 10 },
    { page: 60, atTop: true, entry: 11 },
    { page: 152, atTop: false, entry: 12 },
    { page: 162, atTop: false, entry: 13 }
  ];

  it("counts from the chapter's first page to its last", () => {
    expect(pagesOfChapter(6, 181, starts)).toEqual({ page: 2, total: 55 });
    expect(pagesOfChapter(59, 181, starts)).toEqual({ page: 55, total: 55 });
    expect(pagesOfChapter(60, 181, starts)).toEqual({ page: 1, total: 93 });
    expect(pagesOfChapter(151, 181, starts)).toEqual({ page: 92, total: 93 });
    expect(pagesOfChapter(181, 181, starts)).toEqual({ page: 20, total: 20 });
  });

  it("gives a page shared by two chapters to the one that is ending on it", () => {
    // Page 152 holds the end of the chapter that began on 60 and the first lines of the next.
    expect(chapterOnPage(152, starts)).toBe(1);
    expect(pagesOfChapter(152, 181, starts)).toEqual({ page: 93, total: 93 });
    expect(chapterOnPage(153, starts)).toBe(2);
    expect(pagesOfChapter(153, 181, starts)).toEqual({ page: 2, total: 11 });
    // A chapter that starts at the top of its page has the page to itself.
    expect(chapterOnPage(60, starts)).toBe(1);
  });

  it("gives it to the chapter that starts there when the reader asked for that chapter", () => {
    expect(chapterOnPage(152, starts, 12)).toBe(2);
    expect(pagesOfChapter(152, 181, starts, 12)).toEqual({ page: 1, total: 11 });
    expect(pagesOfChapter(5, 181, starts, 10)).toEqual({ page: 1, total: 55 });
    // Asked for, but another page is showing: the page's own chapter.
    expect(chapterOnPage(100, starts, 12)).toBe(1);
    expect(chapterOnPage(152, starts, 99)).toBe(1);
  });

  it("counts what comes before the file's first chapter from the file's first page", () => {
    expect(pagesOfChapter(1, 181, starts)).toEqual({ page: 1, total: 5 });
    expect(pagesOfChapter(4, 181, starts)).toEqual({ page: 4, total: 5 });
  });

  it("leaves a file with one chapter to the file's own count", () => {
    expect(pagesOfChapter(12, 50, [])).toBeNull();
  });
});

describe("Home and End in a chapter that shares its file (pages)", () => {
  const starts = [{ page: 5, atTop: false }, { page: 60, atTop: true }, { page: 152, atTop: false }];

  it("are the chapter's own first and last pages", () => {
    expect(chapterPageRange(30, 181, starts)).toEqual({ first: 5, last: 59 });
    expect(chapterPageRange(60, 181, starts)).toEqual({ first: 60, last: 152 });
    expect(chapterPageRange(170, 181, starts)).toEqual({ first: 152, last: 181 });
    expect(chapterPageRange(2, 181, starts)).toEqual({ first: 1, last: 5 });
    expect(chapterPageRange(12, 50, [])).toBeNull();
  });
});

describe("previous chapter with pages", () => {
  // An appendix file (section 5): its own entry (3) at the top, then headings (4, 5, 6) inside it; the file before holds entries 1 and 2.
  const entries: ChapterStart[] = [
    { spine: 9, within: 0 }, // 0: "Cover", which leads to the last file
    { spine: 4, within: 0 },
    { spine: 4, within: 0.6 },
    { spine: 5, within: 0 },
    { spine: 5, within: 0.001 },
    { spine: 5, within: 0.3 },
    { spine: 5, within: 0.7 }
  ];

  it("steps past the entries on the page already showing, into the file before", () => {
    // On page 1, under the first heading (4): the file's own entry (3) is on this page too.
    const onPageOne = (entry: number) => entry === 3 || entry === 4;
    expect(earlierEntry(entries, 5, 3, onPageOne)).toBe(2);
  });

  it("goes to the heading before when that is on another page", () => {
    expect(earlierEntry(entries, 5, 5, () => false)).toBe(5);
    expect(earlierEntry(entries, 5, 4, (entry) => entry === 5)).toBe(4);
  });

  it("passes an entry that leads further on in the book, and stops when there is nothing earlier", () => {
    expect(earlierEntry(entries, 4, 0, () => false)).toBe(-1);
    expect(earlierEntry(entries, 4, 1, (entry) => entry === 1)).toBe(-1);
  });
});
