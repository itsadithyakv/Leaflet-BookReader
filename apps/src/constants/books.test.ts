import { describe, expect, it } from "vitest";
import { FINISHED_AT, finishedOn, hasFinished, isFinished } from "./books";

describe("a book finished, ever", () => {
  const march = "2026-03-01T10:00:00.000Z";

  it("is one at its end, or one with a finished date being read again", () => {
    expect(hasFinished({ progress: 1 })).toBe(true);
    expect(hasFinished({ progress: 0.2, finishedAt: march })).toBe(true);
    expect(hasFinished({ progress: 0.5 })).toBe(false);
    // "Not started", said on purpose, is not a date.
    expect(hasFinished({ progress: 0, finishedAt: "" })).toBe(false);
  });

  it("was finished on its date, or when its progress last moved if it has none", () => {
    expect(finishedOn({ progress: 0.2, finishedAt: march, progressUpdatedAt: "2026-09-01T10:00:00.000Z" })).toBe(march);
    expect(finishedOn({ progress: 1, progressUpdatedAt: march, lastOpened: "2026-09-01T10:00:00.000Z" })).toBe(march);
    expect(finishedOn({ progress: 1, lastOpened: march })).toBe(march);
    expect(finishedOn({ progress: 0.5, progressUpdatedAt: march })).toBeNull();
    expect(finishedOn({ progress: 1 })).toBeNull();
  });
});

describe("isFinished", () => {
  it("counts the last page's 0.99x as finished", () => {
    expect(isFinished(0.995)).toBe(true);
    expect(isFinished(FINISHED_AT)).toBe(true);
    expect(isFinished(1)).toBe(true);
  });

  it("does not count a book still being read", () => {
    expect(isFinished(0.98)).toBe(false);
    expect(isFinished(0)).toBe(false);
    expect(isFinished(null)).toBe(false);
    expect(isFinished(undefined)).toBe(false);
  });
});
