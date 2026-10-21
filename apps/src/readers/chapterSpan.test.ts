import { describe, expect, it } from "vitest";
import { readingLineIn } from "./readingPlace";
import { beforeStory, chapterEndWithin, chapterOnPage, chapterPageRange, chapterTail, chapterBook, partEntries, earlierEntry, entryAfter, entryAtShare, entryBefore, entryOfPlace, leadInOf, listedAgain, nextChapterStep, previousChapterStep, startFileOf, nextChapterEntry, pagesOfChapter, previousChapterEntry, type ChapterStart } from "./chapterSpan";

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

// A Kindle book converted by Leaflet: each chapter's epigraph a file of its
// own before it, and a part's two title pages (only the first listed).
// Files: 12 Part One, 13 its subtitle, 14 epigraph, 15 chapter 1, 16 epigraph,
// 17 chapter 2, 18 epigraph, 19 chapter 3, 20 Part Two, 21 subtitle,
// 22 epigraph, 23 chapter 4.
const kindle: ChapterStart[] = [12, 15, 17, 19, 20, 23].map((spine) => ({ spine, within: 0 }));
// The same book with only its parts listed.
const partsOnly: ChapterStart[] = [{ spine: 12, within: 0 }, { spine: 20, within: 0 }, { spine: 40, within: 0 }];

describe("next chapter when the next entry opens a later file", () => {
  it("steps over the files the contents do not list", () => {
    // From chapter 1, past chapter 2's epigraph, to chapter 2.
    expect(entryAfter(kindle, 15)).toBe(2);
    // From an epigraph (the dock names the chapter before it) on to the chapter it opens.
    expect(entryAfter(kindle, 16)).toBe(2);
    // From chapter 3 to Part Two, then past its subtitle and an epigraph to chapter 4.
    expect(entryAfter(kindle, 19)).toBe(4);
    expect(entryAfter(kindle, 20)).toBe(5);
    expect(entryAfter(kindle, 23)).toBe(-1);
  });

  it("is the next file in an ordinary book, as before", () => {
    expect(entryAfter(plain, 1)).toBe(2);
    expect(entryAfter(plain, 3)).toBe(4);
  });

  it("goes past the second file of a chapter a publisher split in two", () => {
    // Files 3 and 4 are chapter four; chapter five is file 5.
    expect(entryAfter(plain, 3)).toBe(4);
    expect(plain[4].spine).toBe(5);
  });

  it("takes the earliest of entries listed out of order, and the first place in a file", () => {
    const shuffled: ChapterStart[] = [{ spine: 9, within: 0 }, { spine: 7, within: 0.5 }, { spine: 7, within: 0.1 }];
    expect(entryAfter(shuffled, 5)).toBe(2);
  });

  it("is the next file when the contents list only the parts", () => {
    expect(entryAfter(partsOnly, 14)).toBe(-1);
    // A part a few files on is within reach.
    expect(entryAfter(partsOnly, 17)).toBe(1);
  });
});

describe("previous chapter when neither chapter starts inside a file", () => {
  it("goes to the start of the chapter before, over the files the contents do not list", () => {
    // From chapter 2, past its own epigraph, to chapter 1.
    expect(entryBefore(kindle, 17)).toBe(1);
    // From an epigraph to the start of the chapter the dock names there.
    expect(entryBefore(kindle, 18)).toBe(2);
    // From chapter 4 back past an epigraph and a subtitle to Part Two.
    expect(entryBefore(kindle, 23)).toBe(4);
    expect(entryBefore(kindle, 12)).toBe(-1);
  });

  it("is the previous file in an ordinary book, as before", () => {
    expect(entryBefore(plain, 2)).toBe(1);
    expect(entryBefore(plain, 5)).toBe(3);
  });

  it("goes to the top of the latest file with entries", () => {
    expect(entryBefore(novel, 3)).toBe(1);
  });

  it("is the previous file when the contents list only the parts", () => {
    expect(entryBefore(partsOnly, 30)).toBe(-1);
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

// The Well of Ascension as Leaflet converted it, a stretch of it: a part's
// title page and its subtitle, then each chapter as two files, its epigraph
// (unlisted, a few hundred bytes) and its text.
// 12 PART ONE · 13 subtitle · 14 ep · 15 Chapter 1 · 16 ep · 17 Chapter 2 · 18 ep · 19 Chapter 3 ·
// 20 PART TWO · 21 subtitle · 22 ep · 23 Chapter 4 · 24 ep · 25 Chapter 5
const wellFiles = [12, 15, 17, 19, 20, 23, 25];
const wellBytes: number[] = [];
[12, 13, 14, 16, 18, 20, 21, 22, 24].forEach((section) => (wellBytes[section] = 380));
[15, 17, 19, 23, 25].forEach((section) => (wellBytes[section] = 25000));
const well = chapterBook(wellFiles.map((spine) => ({ spine, within: 0 })), wellBytes);
const [P1, C1, C2, C3, P2, C4, C5] = [0, 1, 2, 3, 4, 5, 6];

describe("a chapter's epigraph", () => {
  it("is the file a chapter starts in, one file at most", () => {
    expect(leadInOf(17, well.listed, wellBytes, -1)).toBe(16);
    // A part's first chapter starts at its epigraph; the subtitle above it is the part's.
    expect(leadInOf(15, well.listed, wellBytes, -1)).toBe(14);
    expect(startFileOf(well, C4)).toBe(22);
    expect(startFileOf(well, P2)).toBe(20);
  });

  it("never goes back to the file being left", () => {
    expect(leadInOf(15, well.listed, wellBytes, 14)).toBe(15);
  });

  it("is not a large unlisted file (the rest of a chapter split in two), nor one with no text", () => {
    const split = new Set([1, 3]);
    expect(leadInOf(3, split, [0, 30000, 28000, 30000], 1)).toBe(3);
    expect(leadInOf(3, split, [0, 30000, 0, 30000], -1)).toBe(3);
  });
});

describe("the chapter the dock names", () => {
  it("is the chapter an epigraph opens, in the epigraph", () => {
    expect(entryOfPlace(well, 16, C1)).toBe(C2);
    expect(entryOfPlace(well, 14, P1)).toBe(C1);
    expect(entryOfPlace(well, 22, P2)).toBe(C4);
  });

  it("is the part on a part's subtitle, and the entry reached anywhere else", () => {
    expect(entryOfPlace(well, 13, P1)).toBe(P1);
    expect(entryOfPlace(well, 21, P2)).toBe(P2);
    expect(entryOfPlace(well, 17, C2)).toBe(C2);
    expect(entryOfPlace(well, 20, P2)).toBe(P2);
  });
});

describe("next chapter, a chapter at a time", () => {
  /** Where next goes from a place, as the dock names it there. */
  const next = (section: number, reached: number) => nextChapterStep(well, section, entryOfPlace(well, section, reached));

  it("goes from a chapter's text to the next chapter's epigraph, even with it already in the window", () => {
    // Reading the last screen of chapter 2, chapter 3's epigraph and number below: chapter 3, from its epigraph.
    expect(next(17, C2)).toEqual({ entry: C3, file: 18 });
  });

  it("goes on from an epigraph to the chapter after the one it opens", () => {
    // In chapter 3's epigraph the dock says chapter 3: next is Part Two.
    expect(next(18, C2)).toEqual({ entry: P2, file: null });
  });

  it("goes from a part's title page or its subtitle to its first chapter's epigraph", () => {
    expect(next(20, P2)).toEqual({ entry: C4, file: 22 });
    expect(next(21, P2)).toEqual({ entry: C4, file: 22 });
  });

  it("goes on from just past a chapter's number", () => {
    expect(next(23, C4)).toEqual({ entry: C5, file: 24 });
    expect(next(22, P2)).toEqual({ entry: C5, file: 24 });
  });

  it("never goes back to the chapter being read, wherever in it the line is", () => {
    for (let section = 12; section <= 23; section += 1) {
      const reached = [...wellFiles.keys()].filter((entry) => wellFiles[entry] <= section).pop() ?? -1;
      const current = entryOfPlace(well, section, reached);
      const step = nextChapterStep(well, section, current);
      expect(step && step.entry > current, `from file ${section}`).toBe(true);
    }
  });

  it("is nothing at the last chapter", () => {
    expect(next(25, C5)).toBeNull();
  });

  it("is the next file's chapter in an ordinary book, and the next heading inside a file", () => {
    const ordinary = chapterBook(plain, [0, 9000, 9000, 9000, 9000, 9000]);
    expect(nextChapterStep(ordinary, 2, 2)).toEqual({ entry: 3, file: null });
    const shared = chapterBook(novel, []);
    expect(nextChapterStep(shared, 1, 1)).toEqual({ entry: 2, file: null });
    expect(nextChapterStep(shared, 1, 3)).toEqual({ entry: 4, file: null });
  });
});

describe("previous chapter, a chapter at a time", () => {
  const prev = (section: number, reached: number) => previousChapterStep(well, section, entryOfPlace(well, section, reached));

  it("goes from a chapter to the start of the one before, its epigraph", () => {
    expect(prev(17, C2)).toEqual({ entry: C1, file: 14 });
    // From the epigraph that opens chapter 3: chapter 2, not the epigraph's own chapter.
    expect(prev(18, C2)).toEqual({ entry: C2, file: 16 });
  });

  it("goes from a part's first chapter to the part, and from the part to the chapter before it", () => {
    expect(prev(23, C4)).toEqual({ entry: P2, file: null });
    expect(prev(22, P2)).toEqual({ entry: P2, file: null });
    expect(prev(20, P2)).toEqual({ entry: C3, file: 18 });
  });

  it("is nothing before the first entry", () => {
    expect(prev(12, P1)).toBeNull();
  });

  it("is the previous file's chapter in an ordinary book", () => {
    const ordinary = chapterBook(plain, [0, 9000, 9000, 9000, 9000, 9000]);
    expect(previousChapterStep(ordinary, 3, 3)).toEqual({ entry: 2, file: null });
  });
});

describe("a part's title page, counted as its first chapter's way in", () => {
  // The same stretch, the parts known as parts (by their names, or by holding chapters).
  const parts = partEntries(["PART ONE", "Chapter 1", "Chapter 2", "Chapter 3", "PART TWO: Mist", "Chapter 4", "Chapter 5"], [0, 1, 1, 1, 0, 1, 1], (label) => /^part/i.test(label));
  const book = chapterBook(well.entries, wellBytes, parts);
  const next = (section: number, reached: number) => nextChapterStep(book, section, entryOfPlace(book, section, reached));
  const prev = (section: number, reached: number) => previousChapterStep(book, section, entryOfPlace(book, section, reached));

  it("knows a part by its name or by the chapters under it", () => {
    expect([...parts]).toEqual([P1, P2]);
    expect([...partEntries(["Book One", "One", "Two", "Book Two", "Three"], [0, 1, 1, 0, 1], () => false)]).toEqual([0, 3]);
  });

  it("starts the part's first chapter at the part's title page", () => {
    expect(startFileOf(book, C1)).toBe(12);
    expect(startFileOf(book, C4)).toBe(20);
    expect(startFileOf(book, C5)).toBe(24);
  });

  it("names the part's title page, its subtitle and the epigraph for that chapter", () => {
    expect(entryOfPlace(book, 12, P1)).toBe(C1);
    expect(entryOfPlace(book, 13, P1)).toBe(C1);
    expect(entryOfPlace(book, 20, P2)).toBe(C4);
    expect(entryOfPlace(book, 22, P2)).toBe(C4);
  });

  it("goes from the last chapter of a part to the next part's title page, as its first chapter", () => {
    expect(next(19, C3)).toEqual({ entry: C4, file: 20 });
    expect(next(18, C2)).toEqual({ entry: C4, file: 20 });
  });

  it("goes on from the title page to the part's second chapter: one press, not two", () => {
    expect(next(20, P2)).toEqual({ entry: C5, file: 24 });
    expect(next(21, P2)).toEqual({ entry: C5, file: 24 });
  });

  it("goes back from the middle of a part's first chapter to the chapter before, not to the part's title", () => {
    expect(prev(23, C4)).toEqual({ entry: C3, file: 18 });
    expect(prev(20, P2)).toEqual({ entry: C3, file: 18 });
  });

  it("goes back from a part's second chapter to its first, from the part's title page", () => {
    expect(prev(25, C5)).toEqual({ entry: C4, file: 20 });
  });
});

describe("the emulator's skipped chapter (QA round 2, N10)", () => {
  // Chapter 20's last 85px at the top of the window, chapter 21's epigraph
  // (92px) and number below; the dock still said "Chapter 21" from before the
  // reader scrolled up. Next went to chapter 22. Next goes from where the
  // reading line is, not from the dock's last look.
  it("goes to chapter 21 from the last lines of chapter 20 at the top of the window", () => {
    const boxes = [
      { top: -28914, height: 28999 }, // chapter 20's text, its last 85px at the top
      { top: 85, height: 92 }, // chapter 21's epigraph
      { top: 177, height: 11775 } // chapter 21
    ];
    const line = readingLineIn(boxes, 80, 812);
    expect(line?.index).toBe(0);
    // In the fixture: chapter 2's text is file 17, chapter 3's epigraph 18 (as 20 and 21's are 55 and 56).
    const files = [17, 18, 19];
    const section = files[line?.index ?? 0];
    const current = entryOfPlace(well, section, C2);
    expect(current).toBe(C2);
    expect(nextChapterStep(well, section, current)).toEqual({ entry: C3, file: 18 });
  });

  it("goes on to the chapter after once the reading line is in the epigraph", () => {
    const boxes = [
      { top: -28999, height: 28999 },
      { top: 0, height: 92 },
      { top: 92, height: 11775 }
    ];
    const line = readingLineIn(boxes, 80, 812);
    expect(line?.index).toBe(1);
    expect(nextChapterStep(well, 18, entryOfPlace(well, 18, C2))).toEqual({ entry: P2, file: null });
  });
});
