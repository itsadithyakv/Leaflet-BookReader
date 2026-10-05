import { describe, expect, it } from "vitest";
import { groupByBook, keepFrom, searchBook, tally, type SearchHit } from "./searchBook";

/** A made-up book: each section "finds" as many matches as it is told to hold. */
const bookOf = (perSection: number[]) => {
  const loaded: number[] = [];
  return {
    loaded,
    load: () => undefined,
    spine: {
      spineItems: perSection.map((count, index) => ({
        load: async () => {
          loaded.push(index);
        },
        find: () => Array.from({ length: count }, (_, at) => ({ cfi: `epubcfi(/6/${index * 2 + 2}!/4/${at * 2 + 2})`, excerpt: `  a   match ${at} ` })),
        unload: () => undefined
      }))
    }
  };
};

describe("searching a whole book", () => {
  it("keeps a few matches from every section and counts them all", async () => {
    // A name on every page of a four-novel set: 40 in each of 30 chapters.
    const book = bookOf(Array.from({ length: 30 }, () => 40));
    let counts: ReadonlyMap<number, number> = new Map();
    const hits = await searchBook(book, "name", { signal: new AbortController().signal, limit: 1500, perSection: 4, onProgress: (_fraction, _hits, found) => (counts = found) });
    expect(hits).toHaveLength(120);
    // The last chapter is reached: it used to stop in the fifth, 200 matches in.
    expect(hits[hits.length - 1].section).toBe(29);
    expect(tally(counts)).toEqual({ matches: 1200, sections: 30 });
    expect(hits[0].excerpt).toBe("a match 0");
  });

  it("is the first matches and no more when no section is capped, as before", async () => {
    const book = bookOf([150, 150, 150]);
    const hits = await searchBook(book, "name", { signal: new AbortController().signal, limit: 200 });
    expect(hits).toHaveLength(200);
    expect(book.loaded).toEqual([0, 1]);
  });

  it("stops when cancelled, and passes over short queries", async () => {
    const book = bookOf([3, 3, 3, 3]);
    const controller = new AbortController();
    const seen: SearchHit[][] = [];
    await searchBook(book, "name", {
      signal: controller.signal,
      perSection: 4,
      onProgress: (_fraction, hits) => {
        seen.push([...hits]);
        controller.abort();
      }
    });
    expect(book.loaded).toEqual([0]);
    expect(seen).toHaveLength(1);
    expect(await searchBook(book, "n", { signal: new AbortController().signal })).toEqual([]);
  });

  it("groups a set's results by the book they are in, the set's own pages apart", () => {
    // Sections 0-1 the set's own, 2-5 the first book, 6-9 the second, 10 an advert.
    const bookOf = (section: number) => (section < 2 ? -1 : section < 6 ? 0 : section < 10 ? 1 : -1);
    const hit = (section: number, at: number): SearchHit => ({ cfi: `c${section}-${at}`, excerpt: "x", section });
    const hits = [hit(1, 0), hit(3, 0), hit(3, 1), hit(7, 0), hit(10, 0)];
    const counts = new Map([[1, 1], [3, 12], [4, 3], [7, 5], [10, 1]]);
    const groups = groupByBook(hits, counts, bookOf);
    expect(groups.map((group) => [group.book, group.matches, group.hits.map((entry) => entry.index)])).toEqual([
      [-1, 1, [0]],
      [0, 15, [1, 2]],
      [1, 5, [3]],
      [-1, 1, [4]]
    ]);
    expect(groupByBook([], new Map(), bookOf)).toEqual([]);
  });

  it("keeps what there is room for", () => {
    expect(keepFrom(40, 0, 4, 1500)).toBe(4);
    expect(keepFrom(2, 0, 4, 1500)).toBe(2);
    expect(keepFrom(40, 1498, 4, 1500)).toBe(2);
    expect(keepFrom(40, 1500, 4, 1500)).toBe(0);
  });
});
