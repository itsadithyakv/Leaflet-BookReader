import { describe, expect, it } from "vitest";
import { buildSectionWeights, isChapterLike, spineIndexForProgress } from "./progress";

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
});
