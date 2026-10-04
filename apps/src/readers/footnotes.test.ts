import { describe, expect, it } from "vitest";
import { NOTE_MAX_CHARS, classifyNoteLink, isNoteMarker, noteText, type NodeLike, type NoteLinkFacts } from "./footnotes";

const link = (over: Partial<NoteLinkFacts> = {}, target: Partial<NonNullable<NoteLinkFacts["target"]>> | null = {}): NoteLinkFacts => ({
  linkTypes: "",
  linkRole: "",
  text: "1",
  superscript: false,
  ...over,
  target: target === null ? null : { types: "", role: "", blockTag: "p", atBlockStart: true, blockChars: 120, ...target }
});

describe("which links are note references", () => {
  it("takes a link marked as one, whatever it leads to", () => {
    expect(classifyNoteLink(link({ linkTypes: "noteref" }, { blockTag: "aside", types: "footnote" }))).toBe("note");
    expect(classifyNoteLink(link({ linkRole: "doc-noteref", text: "see note" }, { blockTag: "li", blockChars: 4000 }))).toBe("note");
  });

  it("takes a link to something marked as a note", () => {
    expect(classifyNoteLink(link({ text: "a note" }, { types: " rearnote", blockTag: "li" }))).toBe("note");
    expect(classifyNoteLink(link({ text: "a note" }, { role: "doc-endnote", blockTag: "li" }))).toBe("note");
    expect(classifyNoteLink(link({ text: "a note" }, { types: "footnote", blockTag: "aside" }))).toBe("note");
  });

  it("takes the common unmarked kind: a superscript or bracketed number to a small block", () => {
    expect(classifyNoteLink(link({ text: "3", superscript: true }))).toBe("note");
    expect(classifyNoteLink(link({ text: "[4]" }, { blockTag: "div" }))).toBe("note");
    expect(classifyNoteLink(link({ text: "*" }))).toBe("note");
    expect(classifyNoteLink(link({ text: "†" }, { blockTag: "li" }))).toBe("note");
  });

  it("leaves a cross-reference as a jump", () => {
    // "see chapter one": words, not a marker.
    expect(classifyNoteLink(link({ text: "chapter one" }))).toBe("jump");
    // "page 12": a number in the line, neither raised nor bracketed.
    expect(classifyNoteLink(link({ text: "12" }))).toBe("jump");
    // A raised number that leads to a chapter, a heading or a picture.
    expect(classifyNoteLink(link({ text: "2", superscript: true }, { blockTag: "body", blockChars: 30_000 }))).toBe("jump");
    expect(classifyNoteLink(link({ text: "2", superscript: true }, { blockTag: "h2" }))).toBe("jump");
    expect(classifyNoteLink(link({ text: "2", superscript: true }, { blockChars: NOTE_MAX_CHARS + 1 }))).toBe("jump");
  });

  it("leaves the way back from a note to the text as a jump", () => {
    // The note's number, raised, linking to the reference in the middle of its paragraph.
    expect(classifyNoteLink(link({ text: "3", superscript: true }, { atBlockStart: false, blockChars: 400 }))).toBe("jump");
    expect(classifyNoteLink(link({ linkRole: "doc-backlink", text: "↩" }))).toBe("jump");
    expect(classifyNoteLink(link({ linkTypes: "backlink", text: "1", superscript: true }))).toBe("jump");
  });

  it("jumps when the target cannot be found, or is empty", () => {
    expect(classifyNoteLink(link({ linkTypes: "noteref" }, null))).toBe("jump");
    expect(classifyNoteLink(link({ linkTypes: "noteref" }, { blockChars: 0 }))).toBe("jump");
  });

  it("knows a marker when it sees one", () => {
    for (const marker of ["1", "23", "[4]", "(12)", "*", "†", "iv", "a", "7."]) {
      expect(isNoteMarker(marker)).toBe(true);
    }
    for (const words of ["chapter one", "see note", "12345", "Fig. 2", ""]) {
      expect(isNoteMarker(words)).toBe(false);
    }
  });
});

// Plain objects standing in for DOM nodes.
const text = (data: string): NodeLike => ({ nodeType: 3, nodeName: "#text", data, childNodes: [] });
const el = (name: string, children: NodeLike[], attributes: Record<string, string> = {}): NodeLike => ({
  nodeType: 1,
  nodeName: name,
  childNodes: children,
  getAttribute: (key: string) => attributes[key] ?? null
});

describe("a note's text", () => {
  it("is plain text with simple emphasis, and nothing else of the book's markup", () => {
    const note = el("aside", [
      el("p", [
        text("1. The first winter was the coldest in "),
        el("em", [text("forty")]),
        text(" years, and the "),
        el("strong", [text("ice")]),
        text(" reached the island."),
        el("script", [text("alert(1)")]),
        el("img", [], { src: "x.png", onerror: "alert(1)" })
      ])
    ]);
    expect(noteText(note)).toEqual({
      paragraphs: [
        [
          { text: "The first winter was the coldest in " },
          { text: "forty", em: true },
          { text: " years, and the " },
          { text: "ice", strong: true },
          { text: " reached the island." }
        ]
      ],
      truncated: false
    });
  });

  it("leaves out the note's own number and the link back to the text", () => {
    const numbered = el("p", [el("a", [text("3")], { href: "ch2.xhtml#r3" }), text(" Not until the letter of the following summer.")]);
    expect(noteText(numbered).paragraphs).toEqual([[{ text: "Not until the letter of the following summer." }]]);
    const withBack = el("li", [
      el("p", [text("The flood of the "), el("i", [text("second")]), text(" spring. "), el("a", [text("Back")], { href: "ch2.xhtml#r2" })])
    ]);
    expect(noteText(withBack).paragraphs).toEqual([[{ text: "The flood of the " }, { text: "second", em: true }, { text: " spring." }]]);
    const arrow = el("p", [text("[4] Inland. "), el("a", [text("↩")], { href: "#r4", role: "doc-backlink" })]);
    expect(noteText(arrow).paragraphs).toEqual([[{ text: "Inland." }]]);
  });

  it("keeps a link's words, as words", () => {
    const note = el("p", [text("See "), el("a", [text("the appendix")], { href: "app.xhtml" }), text(" for more.")]);
    expect(noteText(note).paragraphs).toEqual([[{ text: "See the appendix for more." }]]);
  });

  it("keeps a note's paragraphs apart", () => {
    const note = el("div", [el("p", [text("[4] Inland, behind the forest.")]), text("\n  "), el("p", [text("A second paragraph.")])]);
    expect(noteText(note).paragraphs).toEqual([[{ text: "Inland, behind the forest." }], [{ text: "A second paragraph." }]]);
  });

  it("stops a long note at a word, and says there is more", () => {
    const long = el("p", [text("word ".repeat(400))]);
    const cut = noteText(long, 100);
    expect(cut.truncated).toBe(true);
    const shown = cut.paragraphs[0][0].text;
    expect(shown.length).toBeLessThanOrEqual(101);
    expect(shown.endsWith("word…")).toBe(true);
    expect(noteText(el("p", [text("Short.")]), 100).truncated).toBe(false);
  });

  it("has nothing to show for a note with no words", () => {
    expect(noteText(el("p", [el("a", [text("1")], { href: "#r1" })]))).toEqual({ paragraphs: [], truncated: false });
  });
});
