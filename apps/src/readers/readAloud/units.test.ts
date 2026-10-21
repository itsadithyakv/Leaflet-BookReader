import { describe, expect, it } from "vitest";
import { chapterSentences } from "./chapterText";
import { buildUnit, chapterSpan, HARD_CHARS, partAt, pauseMs, PAUSE_MS, placeIn, tailOf, UNIT_CHARS } from "./units";

const TEXT = "Chapter One\nIt was cold. The wind blew hard. Nobody came.\nShe waited.";
const chapter = (text = TEXT) => chapterSentences({ text, headings: [{ start: 0, end: text.indexOf("\n") }] }, 3);

describe("building units", () => {
  it("joins a paragraph's sentences into one unit, and keeps a heading and each paragraph apart", () => {
    const sentences = chapter();
    const heading = buildUnit(sentences, 0, { mode: "paragraph", rate: 1, first: true })!;
    expect(heading.text).toBe("Chapter One");
    expect(heading.silence).toBe(0);
    const paragraph = buildUnit(sentences, 1, { mode: "paragraph", rate: 1 })!;
    expect(paragraph.id).toBe("3:1");
    expect(paragraph.text).toBe("It was cold. The wind blew hard. Nobody came.");
    expect(paragraph.parts.map((part) => [part.sentence.n, part.at])).toEqual([
      [1, 0],
      [2, 13],
      [3, 33]
    ]);
    expect(paragraph.silence).toBe(PAUSE_MS.heading);
    const next = buildUnit(sentences, 4, { mode: "paragraph", rate: 1 })!;
    expect(next.text).toBe("She waited.");
    expect(next.silence).toBe(PAUSE_MS.paragraph);
  });

  it("gives a sentence at a time where the voice says nothing of where it is", () => {
    const sentences = chapter();
    expect(buildUnit(sentences, 1, { mode: "sentence", rate: 1 })!.text).toBe("It was cold.");
    expect(buildUnit(sentences, 2, { mode: "sentence", rate: 1 })!.silence).toBe(0);
  });

  it("says a long sentence cut for lighting as one, even a sentence at a time", () => {
    const half = "word ".repeat(40).trim();
    const text = `${half}; ${half}. Next one.`;
    const sentences = chapterSentences({ text }, 0);
    expect(sentences.map((sentence) => Boolean(sentence.cont))).toEqual([true, false, false]);
    const unit = buildUnit(sentences, 0, { mode: "sentence", rate: 1 })!;
    expect(unit.text).toBe(`${half}; ${half}.`);
    expect(unit.parts.length).toBe(2);
  });

  it("cuts a long paragraph only where a sentence ends", () => {
    const sentence = `Word ${"word ".repeat(29).trim()}.`;
    const text = Array.from({ length: 12 }, () => sentence).join(" ");
    const sentences = chapterSentences({ text }, 0);
    const first = buildUnit(sentences, 0, { mode: "paragraph", rate: 1 })!;
    expect(first.text.length).toBeLessThanOrEqual(UNIT_CHARS);
    expect(first.text.endsWith(".")).toBe(true);
    const rest = buildUnit(sentences, first.parts.length, { mode: "paragraph", rate: 1 })!;
    // Within the paragraph: no pause of its own.
    expect(rest.silence).toBe(0);
  });

  it("starts part of the way into a sentence (resuming at a word), and cuts one too long for any voice", () => {
    const sentences = chapter();
    const unit = buildUnit(sentences, 2, { from: 4, mode: "paragraph", rate: 1 })!;
    expect(unit.id).toBe("3:2+4");
    expect(unit.text).toBe("wind blew hard. Nobody came.");
    expect(unit.silence).toBe(0);
    expect(placeIn(unit, 0)).toEqual({ sentence: sentences[2], offset: 4 });
    expect(placeIn(unit, 16).sentence).toBe(sentences[3]);
    const huge = `${"word ".repeat(HARD_CHARS / 4)}end.`;
    const long = chapterSentences({ text: huge }, 0);
    const cut = buildUnit(long, 0, { mode: "paragraph", rate: 1 })!;
    expect(cut.text.length).toBeLessThanOrEqual(HARD_CHARS);
    expect(tailOf(cut).cutShort).toBe(true);
    const after = buildUnit(long, 0, { from: tailOf(cut).part.to, mode: "paragraph", rate: 1 })!;
    expect(after.text.endsWith("end.")).toBe(true);
  });

  it("maps where the voice is to the sentence and the page", () => {
    const sentences = chapter();
    const unit = buildUnit(sentences, 1, { mode: "paragraph", rate: 1 })!;
    expect(partAt(unit, 12).sentence.n).toBe(1);
    expect(partAt(unit, 13).sentence.n).toBe(2);
    const place = placeIn(unit, 22);
    const span = chapterSpan(place.sentence, place.offset, place.offset + 4);
    expect(TEXT.slice(span.start, span.end)).toBe("blew");
  });

  it("makes pauses shorter the faster the reading, within reason", () => {
    expect(pauseMs("paragraph", 1)).toBe(PAUSE_MS.paragraph);
    expect(pauseMs("paragraph", 2)).toBe(PAUSE_MS.paragraph / 2);
    expect(pauseMs("scene", 0.5)).toBe(Math.round(PAUSE_MS.scene / 0.75));
    expect(pauseMs("sentence", 1)).toBe(0);
    expect(PAUSE_MS.scene).toBeGreaterThan(PAUSE_MS.chapter);
    expect(PAUSE_MS.chapter).toBeGreaterThan(PAUSE_MS.heading);
    expect(PAUSE_MS.heading).toBeGreaterThan(PAUSE_MS.paragraph);
    expect(PAUSE_MS.paragraph).toBeGreaterThan(PAUSE_MS.line);
  });
});
