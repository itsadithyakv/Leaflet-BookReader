import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { chapterSentences, sentenceAt, spokenText, type WalkNode } from "./chapterText";

/** A small chapter as an EPUB holds it: XHTML with the usual furniture. */
const CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Chapter 1</title><style>p { margin: 0 }</style></head>
<body>
  <section epub:type="chapter">
    <h1>Chapter One</h1>
    <p>Ash fell from the sky.<a epub:type="noteref" href="#n1">1</a> Vin watched it<sup>2</sup> drift down.</p>
    <span epub:type="pagebreak" id="p12" title="12">12</span>
    <p>She <em>hated</em> the ash. It was everywhere&#8212;in the streets, <img src="x.png" alt="ash"/>on the roofs.</p>
    <p hidden="hidden">A hidden note.</p>
    <p>Kelsier smiled.<br/>Then he spoke.</p>
    <script>var x = 1;</script>
    <aside epub:type="footnote" id="n1"><p>1. A note about ash.</p></aside>
  </section>
</body>
</html>`;

const body = () => {
  const doc = new DOMParser().parseFromString(CHAPTER, "application/xhtml+xml");
  return doc.getElementsByTagName("body")[0] as unknown as WalkNode;
};

describe("spokenText", () => {
  it("walks the chapter in reading order, a line for each block, and leaves out what is not read", () => {
    const { text } = spokenText(body());
    const lines = text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    expect(lines).toEqual([
      "Chapter One",
      "Ash fell from the sky. Vin watched it drift down.",
      "She hated the ash. It was everywhere—in the streets, on the roofs.",
      "Kelsier smiled.",
      "Then he spoke."
    ]);
    expect(text).not.toContain("12");
    expect(text).not.toContain("hidden");
    expect(text).not.toContain("var x");
    expect(text).not.toContain("A note about ash");
  });

  it("knows where each text node starts in the text", () => {
    const spoken = spokenText(body());
    spoken.nodes.forEach((node, index) => {
      const start = spoken.starts[index];
      expect(spoken.text.slice(start, start + (node.data ?? "").length)).toBe(node.data);
    });
  });
});

describe("chapterSentences", () => {
  it("cuts the chapter into sentences, numbered, with their place in its text", () => {
    const spoken = spokenText(body());
    const sentences = chapterSentences(spoken, 4);
    expect(sentences.map((sentence) => sentence.text)).toEqual([
      "Chapter One",
      "Ash fell from the sky.",
      "Vin watched it drift down.",
      "She hated the ash.",
      "It was everywhere—in the streets, on the roofs.",
      "Kelsier smiled.",
      "Then he spoke."
    ]);
    sentences.forEach((sentence, n) => {
      expect(sentence.section).toBe(4);
      expect(sentence.n).toBe(n);
      expect(spoken.text.slice(sentence.start, sentence.end).replace(/\s+/g, " ")).toBe(sentence.text);
    });
  });

  it("finds the sentence a place is in, or the next one", () => {
    const spoken = spokenText(body());
    const sentences = chapterSentences(spoken, 0);
    const vin = sentences[2];
    expect(sentenceAt(sentences, vin.start)).toBe(2);
    expect(sentenceAt(sentences, vin.start + 5)).toBe(2);
    // Between two sentences: the one after.
    expect(sentenceAt(sentences, vin.end)).toBe(3);
    expect(sentenceAt(sentences, 0)).toBe(0);
    expect(sentenceAt(sentences, spoken.text.length + 10)).toBe(sentences.length - 1);
    expect(sentenceAt([], 3)).toBe(-1);
  });
});
