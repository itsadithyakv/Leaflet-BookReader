import { describe, expect, it } from "vitest";
import { highlightsMarkdown } from "./useAnnotations";
import type { Annotation } from "../services/annotationService";

const highlight = (text: string, chapter: string | null, note: string | null = null): Annotation => ({
  id: text,
  bookId: "b",
  kind: "highlight",
  cfi: "epubcfi(/6/2!/4/2,/1:0,/1:5)",
  text,
  note,
  chapter,
  color: "yellow",
  createdAt: "2026-09-28T10:00:00Z",
  updatedAt: "2026-09-28T10:00:00Z"
});

describe("highlightsMarkdown", () => {
  it("groups highlights under their chapters, with notes below", () => {
    const markdown = highlightsMarkdown("A Tale of Two Cities", "Charles Dickens", [
      highlight("It was the best of times", "Chapter 1", "The famous opening."),
      highlight("it was the worst of times", "Chapter 1"),
      highlight("A multitude of people", "Chapter 2")
    ]);
    expect(markdown).toBe(
      [
        "# A Tale of Two Cities",
        "*Charles Dickens*",
        "",
        "## Chapter 1",
        "",
        "> It was the best of times",
        "",
        "The famous opening.",
        "",
        "> it was the worst of times",
        "",
        "## Chapter 2",
        "",
        "> A multitude of people",
        ""
      ].join("\n")
    );
  });

  it("quotes every line of a multi-line highlight", () => {
    expect(highlightsMarkdown("T", null, [highlight("one\ntwo", null)])).toBe("# T\n\n> one\n> two\n");
    // Line breaks as Windows writes them leave nothing behind.
    expect(highlightsMarkdown("T", null, [highlight("one\r\ntwo", null)])).toBe("# T\n\n> one\n> two\n");
  });

  it("keeps a highlighted line that starts like Markdown as the book printed it", () => {
    const text = ["# 1", "- a dash", "1. First", "2) Second", "> quoted", "---", "* * *", "  + indented"].join("\n");
    expect(highlightsMarkdown("T", null, [highlight(text, null)])).toBe(
      [
        "# T",
        "",
        "> \\# 1",
        "> \\- a dash",
        "> 1\\. First",
        "> 2\\) Second",
        "> \\> quoted",
        "> \\---",
        "> \\* * *",
        ">   \\+ indented",
        ""
      ].join("\n")
    );
    // Ordinary lines are left alone, marks inside them too.
    const plain = ["1984 was a year", "#hashtag", "-5 degrees", "a - b", "*starred* word", "3.14"].join("\n");
    expect(highlightsMarkdown("T", null, [highlight(plain, null)])).toBe(
      `# T\n\n${plain
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n`
    );
  });

  it("writes one heading for labels that read the same, on one line", () => {
    const markdown = highlightsMarkdown("T", null, [
      highlight("one", "Chapter\n      1"),
      highlight("two", "Chapter 1 "),
      highlight("three", "  ")
    ]);
    expect(markdown).toBe("# T\n\n## Chapter 1\n\n> one\n\n> two\n\n> three\n");
  });
});
