import { describe, expect, it } from "vitest";
import { bookPlace, bookSpoilerChoices, isPast, seriesPlace, seriesSpoilerChoices, spoilerText } from "./spoilers";

describe("spoilers past where the reader is", () => {
  it("knows the reader's place from the copies of the book they have", () => {
    expect(bookPlace([])).toBeNull();
    expect(bookPlace([{ progress: 0.336 }])).toEqual({ percent: 34, finished: false });
    // An EPUB half read and a PDF finished: they have read it.
    expect(bookPlace([{ progress: 0.5 }, { progress: 1 }])).toEqual({ percent: 100, finished: true });
    // Finished once and being read again is still finished.
    expect(bookPlace([{ progress: 0.1, finishedAt: "2026-03-01T10:00:00Z" }])).toEqual({ percent: 100, finished: true });
  });

  it("covers a thread that goes further than the reader has", () => {
    const at40 = bookPlace([{ progress: 0.4 }]);
    expect(isPast(null, at40)).toBe(false);
    expect(isPast({ percent: 30 }, at40)).toBe(false);
    expect(isPast({ percent: 40 }, at40)).toBe(false);
    expect(isPast({ percent: 41 }, at40)).toBe(true);
    expect(isPast({ percent: 100 }, at40)).toBe(true);
    expect(isPast({ percent: 100 }, bookPlace([{ progress: 1 }]))).toBe(false);
  });

  it("covers everything marked for a reader who does not have the book", () => {
    expect(isPast({ percent: 5 }, null)).toBe(true);
    expect(isPast({ book: 1 }, null)).toBe(true);
    expect(isPast(null, null)).toBe(false);
  });

  it("goes by books finished in a series", () => {
    const place = seriesPlace([
      { index: 1, finished: true },
      { index: 2, finished: true },
      { index: 3, finished: false },
      { index: null, finished: true }
    ]);
    expect(place).toEqual({ finishedThrough: 2 });
    expect(isPast({ book: 2 }, place)).toBe(false);
    expect(isPast({ book: 3 }, place)).toBe(true);
    expect(isPast({ book: 99 }, place)).toBe(true);
    expect(seriesPlace([{ index: 1, finished: false }])).toEqual({ finishedThrough: 0 });
    expect(seriesPlace([])).toBeNull();
    // A book thread in a series community (or the other way) is covered rather than guessed at.
    expect(isPast({ percent: 10 }, place)).toBe(true);
  });

  it("says how far a thread goes", () => {
    expect(spoilerText(null)).toBeNull();
    expect(spoilerText({ percent: 40 })).toBe("Spoilers: the first 40%");
    expect(spoilerText({ percent: 100 })).toBe("Spoilers: the whole book");
    expect(spoilerText({ book: 2 })).toBe("Spoilers: up to book 2");
    expect(spoilerText({ book: 99 })).toBe("Spoilers: the whole series");
  });

  it("offers a writer the marks that make sense", () => {
    expect(bookSpoilerChoices(bookPlace([{ progress: 0.4 }])).map((choice) => choice.label)).toEqual(["No spoilers", "Up to where I am (40%)", "The whole book"]);
    expect(bookSpoilerChoices(bookPlace([{ progress: 1 }])).map((choice) => choice.label)).toEqual(["No spoilers", "The whole book"]);
    expect(bookSpoilerChoices(null)).toHaveLength(2);
    expect(seriesSpoilerChoices(3).map((choice) => choice.label)).toEqual(["No spoilers", "Up to book 1", "Up to book 2", "Up to book 3", "The whole series"]);
  });
});
