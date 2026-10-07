import { beforeEach, describe, expect, it } from "vitest";
import { dayKey, dismiss, dismissedOn, pickBook, pickHighlight, seedOf } from "./highlightOfTheDay";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
  });
});

const now = new Date(2026, 9, 7, 9);
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe("the day", () => {
  it("is the reader's own date", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(dayKey(now)).toBe("2026-10-07");
  });

  it("gives the same number for the same words, and another for others", () => {
    expect(seedOf("book 2026-10-07")).toBe(seedOf("book 2026-10-07"));
    expect(seedOf("book 2026-10-07")).not.toBe(seedOf("book 2026-10-08"));
  });
});

describe("the book the day's highlight comes from", () => {
  it("is none when nothing is highlighted", () => {
    expect(pickBook({}, "2026-10-07")).toBeNull();
    expect(pickBook({ a: 0 }, "2026-10-07")).toBeNull();
  });

  it("is the same all day, whatever order the counts came in", () => {
    const one = pickBook({ a: 3, b: 5, c: 1 }, "2026-10-07");
    expect(pickBook({ c: 1, b: 5, a: 3 }, "2026-10-07")).toBe(one);
    expect(["a", "b", "c"]).toContain(one);
  });

  it("comes more often from a book marked more", () => {
    const seen: Record<string, number> = { a: 0, b: 0 };
    for (let day = 1; day <= 365; day += 1) {
      const key = dayKey(new Date(2026, 0, day));
      seen[pickBook({ a: 1, b: 9 }, key) as string] += 1;
    }
    expect(seen.a).toBeGreaterThan(10);
    expect(seen.b).toBeGreaterThan(seen.a * 4);
  });
});

describe("the day's highlight", () => {
  const marked = (id: string, days: number, text: string | null = "A passage.") => ({ id, text, createdAt: daysAgo(days) });

  it("is one from a week or more ago when there is one", () => {
    const highlights = [marked("new", 0), marked("old", 30), marked("yesterday", 1)];
    for (let day = 1; day <= 40; day += 1) {
      expect(pickHighlight(highlights, dayKey(new Date(2026, 0, day)), now)?.id).toBe("old");
    }
  });

  it("is a new one when they are all new", () => {
    expect(["a", "b"]).toContain(pickHighlight([marked("a", 0), marked("b", 2)], "2026-10-07", now)?.id);
  });

  it("is never one with no words", () => {
    expect(pickHighlight([marked("blank", 30, ""), marked("none", 30, null)], "2026-10-07", now)).toBeNull();
    expect(pickHighlight([marked("blank", 30, " "), marked("worded", 0)], "2026-10-07", now)?.id).toBe("worded");
  });

  it("is the same all day and changes over the days", () => {
    const highlights = Array.from({ length: 12 }, (_, index) => marked(`h${index}`, 20 + index));
    expect(pickHighlight(highlights, "2026-10-07", now)).toBe(pickHighlight([...highlights].reverse(), "2026-10-07", now));
    const over = new Set(Array.from({ length: 30 }, (_, day) => pickHighlight(highlights, dayKey(new Date(2026, 9, day + 1)), now)?.id));
    expect(over.size).toBeGreaterThan(5);
  });
});

describe("putting today's away", () => {
  it("holds for today only", () => {
    expect(dismissedOn("2026-10-07")).toBe(false);
    dismiss("2026-10-07");
    expect(dismissedOn("2026-10-07")).toBe(true);
    expect(dismissedOn("2026-10-08")).toBe(false);
  });
});
