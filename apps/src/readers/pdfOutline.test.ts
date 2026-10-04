import { describe, expect, it } from "vitest";
import { currentOutlineIndex, flattenOutline, resolveOutline, type OutlineLookups, type OutlineNode } from "./pdfOutline";

const ref = (num: number) => ({ num, gen: 0 });

/** A document whose page objects are numbered 100, 101, ... in page order. */
const lookups = (names: Record<string, unknown[] | null> = {}) => {
  const asked: number[] = [];
  const found: OutlineLookups = {
    getDestination: async (name) => names[name] ?? null,
    getPageIndex: async ({ num }) => {
      asked.push(num);
      if (num < 100) {
        throw new Error("not a page");
      }
      return num - 100;
    }
  };
  return { found, asked };
};

const outline: OutlineNode[] = [
  { title: "Contents", dest: [ref(101), { name: "XYZ" }, null, 756, null], items: [] },
  {
    title: "  Part\tOne ",
    dest: "part-one",
    items: [
      { title: "Chapter 1", dest: [ref(103), { name: "Fit" }] },
      { title: "Chapter 2", dest: [ref(109), { name: "Fit" }], items: [{ title: "A note", dest: [ref(110)] }] }
    ]
  },
  { title: "The publisher's site", dest: null, items: [{ title: "Back cover", dest: [11] }] }
];

describe("a PDF's own table of contents", () => {
  it("flattens the tree in reading order with each entry's depth", () => {
    expect(flattenOutline(outline).map((row) => [row.title, row.depth])).toEqual([
      ["Contents", 0],
      ["Part One", 0],
      ["Chapter 1", 1],
      ["Chapter 2", 1],
      ["A note", 2],
      ["Back cover", 1]
    ]);
    expect(flattenOutline(null)).toEqual([]);
  });

  it("names an entry that has no title", () => {
    expect(flattenOutline([{ title: "\u0000 ", dest: [ref(100)] }])[0].title).toBe("Untitled");
  });

  it("turns each destination into a page: a reference, a name, or a page index", async () => {
    const { found } = lookups({ "part-one": [ref(103), { name: "Fit" }] });
    expect(await resolveOutline(outline, found, 12)).toEqual([
      { title: "Contents", page: 2, depth: 0 },
      { title: "Part One", page: 4, depth: 0 },
      { title: "Chapter 1", page: 4, depth: 1 },
      { title: "Chapter 2", page: 10, depth: 1 },
      { title: "A note", page: 11, depth: 2 },
      { title: "Back cover", page: 12, depth: 1 }
    ]);
  });

  it("skips an entry whose destination cannot be found or is outside the book", async () => {
    const { found } = lookups();
    const entries = await resolveOutline(
      [
        { title: "Unknown name", dest: "nowhere" },
        { title: "Not a page", dest: [ref(7)] },
        { title: "Past the end", dest: [ref(150)] },
        { title: "Negative", dest: [-1] },
        { title: "Empty", dest: [] },
        { title: "Kept", dest: [ref(100)] }
      ],
      found,
      10
    );
    expect(entries).toEqual([{ title: "Kept", page: 1, depth: 0 }]);
  });

  it("asks once for a page that many entries share", async () => {
    const { found, asked } = lookups();
    const many = Array.from({ length: 60 }, (_, index) => ({ title: `Section ${index}`, dest: [ref(100 + (index % 3))] }));
    const entries = await resolveOutline(many, found, 5);
    expect(entries).toHaveLength(60);
    expect(asked.sort()).toEqual([100, 101, 102]);
  });

  it("stops looking when the book is closed part way", async () => {
    const { found, asked } = lookups();
    const many = Array.from({ length: 100 }, (_, index) => ({ title: `Section ${index}`, dest: [ref(100 + index)] }));
    let batches = 0;
    const entries = await resolveOutline(many, found, 200, () => (batches += 1) <= 2);
    expect(entries).toBeNull();
    expect(asked.length).toBeLessThan(100);
  });

  it("marks the entry the page in view belongs to", () => {
    const entries = [
      { title: "Contents", page: 2, depth: 0 },
      { title: "Part One", page: 4, depth: 0 },
      { title: "Chapter 1", page: 4, depth: 1 },
      { title: "Chapter 2", page: 10, depth: 1 }
    ];
    expect(currentOutlineIndex(entries, 1)).toBe(-1);
    expect(currentOutlineIndex(entries, 2)).toBe(0);
    expect(currentOutlineIndex(entries, 3)).toBe(0);
    // A part and its first chapter start together: the chapter is the nearer answer.
    expect(currentOutlineIndex(entries, 4)).toBe(2);
    expect(currentOutlineIndex(entries, 9)).toBe(2);
    expect(currentOutlineIndex(entries, 40)).toBe(3);
    expect(currentOutlineIndex([], 3)).toBe(-1);
  });

  it("is not thrown by an entry that points back (an appendix listed out of order)", () => {
    const entries = [
      { title: "Chapter 1", page: 5, depth: 0 },
      { title: "Chapter 2", page: 20, depth: 0 },
      { title: "Errata", page: 3, depth: 0 }
    ];
    expect(currentOutlineIndex(entries, 4)).toBe(2);
    expect(currentOutlineIndex(entries, 12)).toBe(0);
    expect(currentOutlineIndex(entries, 25)).toBe(1);
  });
});
