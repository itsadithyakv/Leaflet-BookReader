import { describe, expect, it } from "vitest";
import { buildSectionWeights, isChapterLike, spineIndexForProgress, outsideStory, endInView, STILL_READING_MAX, endReached, onLastPage, progressToSave, storySpan, isOutsideLabel, isBackMatterFile } from "./progress";
import { isFinished } from "../constants/books";

const section = (href: string, bytes: number, linear = true) => ({ href, bytes, linear });
const spine = (items: { href: string }[]) => items.map((item) => item.href);
const indexer = (hrefs: string[]) => (href: string) => {
  const index = hrefs.indexOf(href.split("#")[0]);
  return index >= 0 ? index : undefined;
};

describe("buildSectionWeights", () => {
  it("weighs sections by size, not by count", () => {
    const sections = [section("a.xhtml", 1000), section("b.xhtml", 9000)];
    const hrefs = spine(sections);
    const weights = buildSectionWeights(hrefs, sections, [], indexer(hrefs));
    expect(weights).not.toBeNull();
    // The end of the short first chapter is a tenth of the book, not half.
    const w = weights!;
    expect((w.prefix[1] - w.prefix[w.lo]) / (w.prefix[w.hi + 1] - w.prefix[w.lo])).toBeCloseTo(0.1);
  });

  it("does not jump to 50% for a Prologue, titled chapters, Epilogue book", () => {
    const sections = [
      section("prologue.xhtml", 1000),
      section("boy.xhtml", 5000),
      section("glass.xhtml", 5000),
      section("epilogue.xhtml", 1000)
    ];
    const hrefs = spine(sections);
    const toc = [
      { href: "prologue.xhtml", label: "Prologue" },
      { href: "boy.xhtml", label: "The Boy Who Lived" },
      { href: "glass.xhtml", label: "The Vanishing Glass" },
      { href: "epilogue.xhtml", label: "Epilogue" }
    ];
    const w = buildSectionWeights(hrefs, sections, toc, indexer(hrefs))!;
    // Prologue and Epilogue frame the story; everything between counts by size.
    expect(w.lo).toBe(0);
    expect(w.hi).toBe(3);
    const startOfSecond = (w.prefix[2] - w.prefix[0]) / (w.prefix[4] - w.prefix[0]);
    expect(startOfSecond).toBeCloseTo(6000 / 12000);
    const startOfFirst = (w.prefix[1] - w.prefix[0]) / (w.prefix[4] - w.prefix[0]);
    expect(startOfFirst).toBeCloseTo(1000 / 12000);
  });

  it("leaves front matter at 0% and stops at the back matter, keeping a split last chapter", () => {
    const sections = [
      section("cover.xhtml", 200),
      section("copyright.xhtml", 300),
      section("ch1.xhtml", 4000),
      section("ch2.xhtml", 4000),
      section("ch2b.xhtml", 3000),
      section("acks.xhtml", 800),
      section("notes.xhtml", 500, false)
    ];
    const hrefs = spine(sections);
    const toc = [
      { href: "copyright.xhtml", label: "Copyright" },
      { href: "ch1.xhtml", label: "Chapter 1" },
      { href: "ch2.xhtml", label: "Chapter 2" },
      { href: "acks.xhtml", label: "Acknowledgements" }
    ];
    const w = buildSectionWeights(hrefs, sections, toc, indexer(hrefs))!;
    expect(w.lo).toBe(2);
    expect(w.hi).toBe(4);
    expect(w.last).toBe(4);
    expect(w.bytes[6]).toBe(0);
  });

  it("uses the whole book when chapter titles do not frame it", () => {
    const sections = [section("a.xhtml", 1000), section("b.xhtml", 1000), section("c.xhtml", 50000)];
    const hrefs = spine(sections);
    // Two "chapters" covering only a sliver of the book are not the story.
    const toc = [
      { href: "a.xhtml", label: "Chapter 1" },
      { href: "b.xhtml", label: "Chapter 2" },
      { href: "c.xhtml", label: "Appendix" }
    ];
    const w = buildSectionWeights(hrefs, sections, toc, indexer(hrefs))!;
    expect(w.lo).toBe(0);
    expect(w.hi).toBe(2);
  });

  it("returns null when no sizes match the spine", () => {
    expect(buildSectionWeights(["x.xhtml"], [section("y.xhtml", 10)], [], () => undefined)).toBeNull();
  });

  it("matches percent-encoded hrefs", () => {
    const w = buildSectionWeights(["Text/My%20Chapter.xhtml"], [section("Text/My Chapter.xhtml", 10)], [], () => 0);
    expect(w?.bytes[0]).toBe(10);
  });
});

describe("spineIndexForProgress", () => {
  it("finds the section a stored fraction falls in", () => {
    const sections = [section("a", 1000), section("b", 1000), section("c", 2000)];
    const hrefs = spine(sections);
    const w = buildSectionWeights(hrefs, sections, [], indexer(hrefs))!;
    expect(spineIndexForProgress(w, 0.1)).toBe(0);
    expect(spineIndexForProgress(w, 0.3)).toBe(1);
    expect(spineIndexForProgress(w, 0.75)).toBe(2);
    expect(spineIndexForProgress(w, 1)).toBe(2);
  });
});

describe("isChapterLike", () => {
  it("recognises chapter labels and skips front matter", () => {
    expect(isChapterLike("Chapter 12")).toBe(true);
    expect(isChapterLike("Prologue")).toBe(true);
    expect(isChapterLike("XIV")).toBe(true);
    expect(isChapterLike("Copyright")).toBe(false);
    expect(isChapterLike("The Boy Who Lived")).toBe(false);
  });

  it("takes a number, with or without a title, for a chapter", () => {
    expect(isChapterLike("12")).toBe(true);
    expect(isChapterLike("12.")).toBe(true);
    expect(isChapterLike("1: The Long Road")).toBe(true);
    expect(isChapterLike("7. A Lamp")).toBe(true);
    expect(isChapterLike("3 · Salt")).toBe(true);
    // Not a year in a title, a count, or a date.
    expect(isChapterLike("1984 and After")).toBe(false);
    expect(isChapterLike("12 Rules for a Quiet Life")).toBe(false);
    expect(isChapterLike("2001: A Space Odyssey")).toBe(false);
  });
});

describe("a look outside the story", () => {
  it("does not reset progress: the map opened from chapter 20 leaves it, and the place, alone", () => {
    expect(outsideStory("front", 0.62)).toEqual({ progress: null, placeFollows: false });
    expect(outsideStory("front", 0.05)).toEqual({ progress: null, placeFollows: false });
  });

  it("is reading when the reader really is at the start", () => {
    expect(outsideStory("front", 0)).toEqual({ progress: 0, placeFollows: true });
    expect(outsideStory("front", 0.015)).toEqual({ progress: 0, placeFollows: true });
    // A book never opened before has no progress to speak of.
    expect(outsideStory("front", Number.NaN)).toEqual({ progress: 0, placeFollows: true });
  });

  it("leaves progress where the story is for back matter: a footnote is not finishing the book", () => {
    expect(outsideStory("back", 0.4)).toEqual({ progress: null, placeFollows: false });
  });

  it("lets the place follow into the back matter once the story is finished", () => {
    expect(outsideStory("back", 1)).toEqual({ progress: null, placeFollows: true });
    expect(outsideStory("back", 0.99)).toEqual({ progress: null, placeFollows: true });
  });
});

describe("the end of the story, scrolling", () => {
  it("is reached when the last line is in the window", () => {
    // A last chapter of 400 px under a window of 768: its end sits at the bottom edge.
    expect(endInView(768, 768)).toBe(true);
    expect(endInView(300, 768)).toBe(true);
    // A scroll position between pixels.
    expect(endInView(768.6, 768)).toBe(true);
  });

  it("is not reached while the last line is still below the window, or has gone above it", () => {
    expect(endInView(1400, 768)).toBe(false);
    expect(endInView(-20, 768)).toBe(false);
    expect(endInView(null, 768)).toBe(false);
  });
});

describe("finished means the end was reached", () => {
  it("stops just short of finished while there is story left, whatever the weights say", () => {
    // Page 9 of 23 of a short epilogue: 99.2% of the book by size.
    expect(progressToSave(0.992, false)).toBe(STILL_READING_MAX);
    expect(isFinished(progressToSave(0.992, false))).toBe(false);
    expect(isFinished(progressToSave(0.9999, false))).toBe(false);
  });

  it("leaves ordinary progress alone", () => {
    expect(progressToSave(0.42, false)).toBe(0.42);
    expect(progressToSave(0, false)).toBe(0);
    expect(progressToSave(Number.NaN, false)).toBe(0);
  });

  it("is finished at the end, however little the last section weighs", () => {
    expect(progressToSave(0.952, true)).toBe(1);
    expect(isFinished(progressToSave(0.952, true))).toBe(true);
  });

  it("keeps a finished book finished among its last pages, and lets it go further back", () => {
    expect(progressToSave(0.994, false, true)).toBe(0.994);
    expect(isFinished(progressToSave(0.994, false, true))).toBe(true);
    expect(isFinished(progressToSave(0.9, false, true))).toBe(false);
  });

  it("knows the last page of the story's last section", () => {
    expect(onLastPage(51, 51, 23, 23)).toBe(true);
    expect(onLastPage(51, 51, 22, 23)).toBe(false);
    expect(onLastPage(50, 51, 30, 30)).toBe(false);
    // A last section of one page.
    expect(onLastPage(8, 8, 1, 1)).toBe(true);
  });

  it("counts an end that a long scroll carried past the window between two looks", () => {
    // Below the window, then above it.
    expect(endReached(-300, 768, true)).toBe(true);
    // Above it without having been seen below (a jump into the notes): not reached.
    expect(endReached(-300, 768, false)).toBe(false);
    expect(endReached(500, 768, false)).toBe(true);
    expect(endReached(1500, 768, true)).toBe(false);
    expect(endReached(null, 768, true)).toBe(false);
  });
});

describe("the story's span when chapters have names of their own", () => {
  // A made-up novel: a prologue, chapters named for who tells them, appendices.
  const novel = (name: string, chapters: number, epilogue = false) => [
    { href: `${name}-cover.xhtml`, label: "Cover", bytes: 300 },
    { href: `${name}-title.xhtml`, label: "Title Page", bytes: 300 },
    { href: `${name}-maps.xhtml`, label: "Maps", bytes: 300 },
    { href: `${name}-prologue.xhtml`, label: "PROLOGUE", bytes: 9000 },
    ...Array.from({ length: chapters }, (_, index) => ({ href: `${name}-c${index + 1}.xhtml`, label: ["ANNA", "BORIS", "CLARA"][index % 3], bytes: 10000 })),
    ...(epilogue ? [{ href: `${name}-epilogue.xhtml`, label: "EPILOGUE", bytes: 7000 }] : []),
    { href: `${name}-app.xhtml`, label: "APPENDIX: THE HOUSES", bytes: 6000 },
    { href: `${name}-ack.xhtml`, label: "ACKNOWLEDGMENTS", bytes: 500 }
  ];
  const weigh = (files: { href: string; label: string; bytes: number }[]) => {
    const hrefs = files.map((file) => file.href);
    return buildSectionWeights(hrefs, files.map((file) => section(file.href, file.bytes)), files, indexer(hrefs))!;
  };

  it("runs from the prologue to the last named chapter of one such novel", () => {
    const files = novel("one", 12);
    const w = weigh(files);
    expect(files[w.lo].label).toBe("PROLOGUE");
    expect(files[w.hi].href).toBe("one-c12.xhtml");
    expect(w.last).toBe(w.hi);
  });

  it("runs to the last novel's last chapter in a set of them, not to its prologue", () => {
    const files = [...novel("one", 10), ...novel("two", 10), ...novel("three", 10, true), ...novel("four", 10)];
    const w = weigh(files);
    expect(files[w.lo].href).toBe("one-prologue.xhtml");
    // It used to end at "four-prologue.xhtml": the fourth novel was back matter.
    expect(files[w.hi].href).toBe("four-c10.xhtml");
  });

  it("still ends at the epilogue when a short named piece follows it", () => {
    const files = [...novel("one", 12, true).slice(0, -2), { href: "arcana.xhtml", label: "Ars Arcanum", bytes: 4000 }, { href: "about.xhtml", label: "About the Author", bytes: 300 }];
    const w = weigh(files);
    expect(files[w.hi].label).toBe("EPILOGUE");
  });

  it("is every section when one prologue is all there is to go on and little follows it", () => {
    const files = [
      { href: "a.xhtml", label: "Prologue", bytes: 5000 },
      { href: "b.xhtml", label: "Introduction", bytes: 5000 },
      { href: "c.xhtml", label: "The Text", bytes: 400 }
    ];
    const w = weigh(files);
    expect([w.lo, w.hi]).toEqual([0, 2]);
  });

  it("names what is outside a story", () => {
    for (const label of ["APPENDIX II: OTHER HOUSES", "Acknowledgements", "EXCERPT FROM THE NEXT ONE", "Special Preview of the Sequel", "ALSO BY THE AUTHOR", "A Note About the Author", "Cover", "Title Page", "Maps"]) {
      expect(isOutsideLabel(label)).toBe(true);
    }
    for (const label of ["TYRION", "The Prophet", "A Note on Chronology", "Epilogue", "Ars Arcanum", "Meanwhile, Back on the Wall"]) {
      expect(isOutsideLabel(label)).toBe(false);
    }
  });

  it("runs to the last chapter when chapters are numbered and named with no word for chapter", () => {
    // "12: The Willow" under "Part II: Break": only the prologue reads as a chapter. The story used to be
    // the whole file, "About the Author" and all, and the book could not be finished at its last chapter.
    const files = [
      { href: "cover.xhtml", label: "Cover", bytes: 300 },
      { href: "info.xhtml", label: "eBook Information", bytes: 300 },
      { href: "title.xhtml", label: "Title Page", bytes: 300 },
      { href: "prologue.xhtml", label: "Prologue", bytes: 3000 },
      { href: "p1.xhtml", label: "Part I: Bow", bytes: 200 },
      ...Array.from({ length: 6 }, (_, index) => ({ href: `c${index + 1}.xhtml`, label: `${index + 1}: A Name`, bytes: 9000 })),
      { href: "about.xhtml", label: "About the Author", bytes: 400 }
    ];
    const w = weigh(files);
    expect(files[w.lo].label).toBe("Prologue");
    expect(files[w.hi].href).toBe("c6.xhtml");
    expect(isChapterLike("eBook Information")).toBe(false);
    expect(isChapterLike("Book One")).toBe(true);
    expect(isChapterLike("The Book of Sand")).toBe(true);
  });

  it("ends a collection of stories at its last story, when no entry reads as a chapter", () => {
    // Two stories split over files, then the publisher's pages; "also.xhtml" lists other books and is not in the contents.
    const files = [
      { href: "x/cover.xhtml", label: "Cover", bytes: 400 },
      { href: "x/title.xhtml", label: "Title Page", bytes: 600 },
      { href: "x/about.xhtml", label: "About the Author", bytes: 1500 },
      { href: "x/story001.xhtml", label: "The Long Nights", bytes: 30000 },
      { href: "x/story002.xhtml", label: "", bytes: 30000 },
      { href: "x/story003.xhtml", label: "The Graveyard", bytes: 40000 },
      { href: "x/appendix001.xhtml", label: "", bytes: 15000 },
      { href: "x/endpage.xhtml", label: "Follow Us", bytes: 1500 },
      { href: "x/copyright.xhtml", label: "Copyright Page", bytes: 1200 }
    ];
    const hrefs = files.map((file) => file.href);
    const toc = files.filter((file) => file.label);
    const w = buildSectionWeights(hrefs, files.map((file) => section(file.href, file.bytes)), toc, indexer(hrefs))!;
    expect(files[w.lo].href).toBe("x/story001.xhtml");
    // It used to be the copyright page: 99% was reached on "Follow Us".
    expect(files[w.hi].href).toBe("x/story003.xhtml");
    expect(w.last).toBe(w.hi);
  });

  it("keeps an unlisted last file that is not named for back matter, and leaves a book alone when nothing frames it", () => {
    const split = [
      { href: "title.xhtml", label: "Title Page", bytes: 500 },
      { href: "one.xhtml", label: "The First Story", bytes: 20000 },
      { href: "two.xhtml", label: "The Second Story", bytes: 20000 },
      { href: "two_split_001.xhtml", label: "", bytes: 20000 },
      { href: "copyright.xhtml", label: "Copyright", bytes: 800 }
    ];
    const hrefs = split.map((file) => file.href);
    const w = buildSectionWeights(hrefs, split.map((file) => section(file.href, file.bytes)), split.filter((file) => file.label), indexer(hrefs))!;
    expect([w.lo, w.hi]).toEqual([1, 3]);
    const plain = [
      { href: "a.xhtml", label: "The First Story", bytes: 20000 },
      { href: "b.xhtml", label: "The Second Story", bytes: 20000 }
    ];
    const names = plain.map((file) => file.href);
    const whole = buildSectionWeights(names, plain.map((file) => section(file.href, file.bytes)), plain, indexer(names))!;
    expect([whole.lo, whole.hi]).toEqual([0, 1]);
  });

  it("knows a file named for back matter", () => {
    for (const href of ["OPS/xhtml/appendix001.xhtml", "endpage.xhtml", "OEBPS/Mart_9780553900323_epub_bm2_r1.htm", "Text/copyright.xhtml", "ata.html", "back_matter.xhtml", "ad1.xhtml", "also_by.xhtml"]) {
      expect(isBackMatterFile(href)).toBe(true);
    }
    for (const href of ["chapter007.xhtml", "adventure.xhtml", "index_split_003.html", "aboutface.xhtml", "bmw.xhtml", "part2.xhtml", "ch_appendix.xhtml"]) {
      expect(isBackMatterFile(href)).toBe(false);
    }
  });

  it("can be asked of part of a book", () => {
    const files = [...novel("one", 10), ...novel("two", 10, true)];
    const prefix = [0];
    files.forEach((file, index) => prefix.push(prefix[index] + file.bytes));
    const entries = files.map((file, spine) => ({ spine, label: file.label }));
    const second = files.findIndex((file) => file.href === "two-cover.xhtml");
    const span = storySpan(entries, prefix, second, files.length - 1)!;
    expect(files[span.lo].href).toBe("two-prologue.xhtml");
    expect(files[span.hi].href).toBe("two-epilogue.xhtml");
  });
});
