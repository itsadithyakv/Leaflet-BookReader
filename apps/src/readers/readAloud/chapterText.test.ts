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

const BREAKS = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <h2>CHAPTER XIV</h2>
  <p><span class="dropcap">T</span>
    he night was long. It rained.</p>
  <p>Then morning came.[3]</p>
  <p class="center">* * *</p>
  <p>Later, she woke.</p>
  <hr/>
  <p>Roses are red,<br/>violets are blue.</p>
  <div class="drop-cap">A</div><p>nother day began.</p>
  <p><sup>4</sup>[12]</p>
  <div class="scenebreak"></div>
  <p>The end.</p>
</body>
</html>`;

describe("what is heard as a pause or a join", () => {
  const spoken = () => spokenText(new DOMParser().parseFromString(BREAKS, "application/xhtml+xml").getElementsByTagName("body")[0] as unknown as WalkNode);

  it("says each sentence as it should be heard, with the pause it follows", () => {
    const sentences = chapterSentences(spoken(), 2);
    expect(sentences.map((sentence) => [sentence.say, sentence.lead])).toEqual([
      ["Chapter 14", "chapter"],
      ["The night was long.", "heading"],
      ["It rained.", "sentence"],
      ["Then morning came.", "paragraph"],
      ["Later, she woke.", "scene"],
      ["Roses are red,", "scene"],
      ["violets are blue.", "line"],
      ["Another day began.", "paragraph"],
      // A paragraph of nothing but markers is passed over; the scene break after it is kept.
      ["The end.", "scene"]
    ]);
    expect(sentences.map((sentence) => sentence.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sentences[0].heading).toBe(true);
    expect(sentences[1].heading).toBe(false);
    // Sentences of one paragraph share a block.
    expect(sentences[1].block).toBe(sentences[2].block);
    expect(sentences[3].block).toBeGreaterThan(sentences[2].block);
  });

  it("keeps the page's own text for lighting, and maps what is said back to it", () => {
    const facts = spoken();
    const sentences = chapterSentences(facts, 2);
    const night = sentences[1];
    expect(night.text).toBe("T he night was long.");
    const at = night.say.indexOf("night");
    expect(facts.text.slice(night.map[at], night.map[at + 5])).toBe("night");
    expect(night.map.length).toBe(night.say.length + 1);
    expect(night.map[night.say.length]).toBe(night.end);
  });
});

describe("the book's own source lines", () => {
  // A paragraph wrapped over several lines of the file (Project Gutenberg's books are set so):
  // the page shows each newline as a space, and the voice reads on across it.
  const WRAPPED = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <p>It was the best of times,
  it was the worst of times. And so
  on.</p>
  <p>Next one.</p>
  <pre>first line
second line</pre>
</body>
</html>`;
  const facts = () => spokenText(new DOMParser().parseFromString(WRAPPED, "application/xhtml+xml").getElementsByTagName("body")[0] as unknown as WalkNode);

  it("never ends a sentence, nor pauses for a paragraph, at a newline of the file inside a paragraph", () => {
    const sentences = chapterSentences(facts(), 0);
    expect(sentences.map((sentence) => [sentence.say, sentence.lead])).toEqual([
      ["It was the best of times, it was the worst of times.", "chapter"],
      ["And so on.", "sentence"],
      ["Next one.", "paragraph"],
      // (Set as it is in the file: its own newlines are lines.)
      ["first line", "paragraph"],
      ["second line", "line"]
    ]);
    expect(sentences[0].block).toBe(sentences[1].block);
  });

  it("keeps every offset where it was (a sentence is lit on the page by them)", () => {
    const spoken = facts();
    for (const sentence of chapterSentences(spoken, 0)) {
      expect(spoken.text.slice(sentence.start, sentence.end).replace(/\s+/g, " ")).toBe(sentence.text);
    }
  });
});
