import { describe, expect, it } from "vitest";
import { orderHighlights } from "../components/highlights/highlightsView";
import type { Annotation } from "../services/annotationService";
import { MAX_RECTS, comparePlaces, decodePlace, encodePlace, highlightAt, isPdfPlace, lineRects, pagePlace, selectedWords, toPageRects } from "./pdfHighlights";

describe("a place in a PDF, as it is stored", () => {
  it("is the page and what the highlight covers, and reads back the same", () => {
    const place = { page: 12, rects: [{ left: 0.1234, top: 0.2, width: 0.5, height: 0.018 }, { left: 0.1, top: 0.22, width: 0.3, height: 0.018 }] };
    const stored = encodePlace(place);
    expect(stored).toBe("pdf:12:1234,2000,5000,180;1000,2200,3000,180");
    expect(decodePlace(stored)).toEqual(place);
  });

  it("is told from an EPUB's CFI", () => {
    expect(isPdfPlace("pdf:3:1,2,3,4")).toBe(true);
    expect(isPdfPlace("epubcfi(/6/4!/4/2,/1:0,/1:5)")).toBe(false);
    expect(decodePlace("epubcfi(/6/4!/4/2,/1:0,/1:5)")).toBeNull();
    expect(isPdfPlace(null)).toBe(false);
  });

  it("can be a page alone", () => {
    expect(pagePlace(7)).toBe("pdf:7");
    expect(decodePlace("pdf:7")).toEqual({ page: 7, rects: [] });
  });

  it("is not read when it is damaged", () => {
    for (const stored of ["pdf:", "pdf:0:1,2,3,4", "pdf:x:1,2,3,4", "pdf:3:1,2,3", "pdf:3:1,2,3,99999", "pdf:3:a,b,c,d", "pdf:1.5"]) {
      expect(decodePlace(stored), stored).toBeNull();
    }
  });

  it("keeps a figure inside the page, and no more of a highlight than a page of lines", () => {
    expect(encodePlace({ page: 1, rects: [{ left: -0.2, top: 1.4, width: 0.5, height: 0.01 }] })).toBe("pdf:1:0,10000,5000,100");
    const many = Array.from({ length: MAX_RECTS + 30 }, (_, at) => ({ left: 0.1, top: at / 1000, width: 0.5, height: 0.0008 }));
    expect(decodePlace(encodePlace({ page: 1, rects: many }))?.rects).toHaveLength(MAX_RECTS);
  });
});

describe("which place comes first", () => {
  const at = (page: number, top: number, left = 0.1) => encodePlace({ page, rects: [{ left, top, width: 0.2, height: 0.02 }] });

  it("is by page, then down the page, then along the line", () => {
    expect(comparePlaces(at(2, 0.9), at(3, 0.1))).toBeLessThan(0);
    expect(comparePlaces(at(3, 0.5), at(3, 0.2))).toBeGreaterThan(0);
    expect(comparePlaces(at(3, 0.5, 0.1), at(3, 0.5, 0.6))).toBeLessThan(0);
    expect(comparePlaces(at(3, 0.5), at(3, 0.5))).toBe(0);
    // A bookmark's bare page comes before anything on it.
    expect(comparePlaces(pagePlace(3), at(3, 0.2))).toBeLessThan(0);
  });

  it("puts a list of highlights in reading order, an unreadable one last", () => {
    const item = (id: string, cfi: string): Annotation => ({ id, bookId: "b", kind: "highlight", cfi, createdAt: `2026-01-0${id}`, updatedAt: "" });
    const ordered = orderHighlights([item("1", at(9, 0.1)), item("2", "pdf:broken"), item("3", at(2, 0.8)), item("4", at(2, 0.3))], comparePlaces);
    expect(ordered.map((entry) => entry.id)).toEqual(["4", "3", "1", "2"]);
  });
});

describe("a selection's rectangles, made fit to keep", () => {
  it("joins the runs of a line into one bar", () => {
    // Three runs of one line, a space apart, and the same run given twice.
    const line = lineRects([
      { left: 0.1, top: 0.2, width: 0.1, height: 0.02 },
      { left: 0.1, top: 0.2, width: 0.1, height: 0.02 },
      { left: 0.205, top: 0.201, width: 0.2, height: 0.019 },
      { left: 0.41, top: 0.2, width: 0.15, height: 0.02 }
    ]);
    expect(line).toHaveLength(1);
    expect(line[0].left).toBeCloseTo(0.1);
    expect(line[0].width).toBeCloseTo(0.46);
    expect(line[0].height).toBeCloseTo(0.02);
  });

  it("keeps one bar a line", () => {
    const lines = lineRects([
      { left: 0.5, top: 0.2, width: 0.4, height: 0.02 },
      { left: 0.1, top: 0.23, width: 0.8, height: 0.02 },
      { left: 0.1, top: 0.26, width: 0.3, height: 0.02 }
    ]);
    expect(lines.map((rect) => rect.top)).toEqual([0.2, 0.23, 0.26]);
  });

  it("keeps two columns apart on the same line", () => {
    expect(
      lineRects([
        { left: 0.1, top: 0.2, width: 0.3, height: 0.02 },
        { left: 0.6, top: 0.2, width: 0.3, height: 0.02 }
      ])
    ).toHaveLength(2);
  });

  it("puts them in order whatever order they came in", () => {
    const lines = lineRects([
      { left: 0.1, top: 0.5, width: 0.3, height: 0.02 },
      { left: 0.3, top: 0.2, width: 0.2, height: 0.02 },
      { left: 0.1, top: 0.2, width: 0.2, height: 0.02 }
    ]);
    expect(lines.map((rect) => [rect.top, rect.left])).toEqual([
      [0.2, 0.1],
      [0.5, 0.1]
    ]);
  });

  it("leaves out what is off the page or nothing at all, and trims what hangs over", () => {
    const kept = lineRects([
      { left: 1.2, top: 0.2, width: 0.1, height: 0.02 },
      { left: 0.1, top: 0.4, width: 0, height: 0.02 },
      { left: 0.9, top: 0.6, width: 0.3, height: 0.02 }
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].left).toBeCloseTo(0.9);
    expect(kept[0].width).toBeCloseTo(0.1);
  });
});

describe("rectangles in the window, as fractions of their page", () => {
  it("are measured from the page's own corner", () => {
    expect(toPageRects([{ left: 300, top: 250, width: 200, height: 20 }], { left: 100, top: 50, width: 800, height: 1000 })).toEqual([
      { left: 0.25, top: 0.2, width: 0.25, height: 0.02 }
    ]);
  });

  it("are none for a page that has no size yet", () => {
    expect(toPageRects([{ left: 1, top: 1, width: 1, height: 1 }], { left: 0, top: 0, width: 0, height: 0 })).toEqual([]);
  });
});

describe("the highlight under the pointer", () => {
  const big = { id: "big", rects: [{ left: 0.1, top: 0.2, width: 0.8, height: 0.1 }] };
  const small = { id: "small", rects: [{ left: 0.3, top: 0.22, width: 0.1, height: 0.02 }] };

  it("is the one whose words the point is on", () => {
    expect(highlightAt([big], 0.5, 0.25)?.id).toBe("big");
    expect(highlightAt([big], 0.5, 0.5)).toBeNull();
  });

  it("is the smaller of two, one made inside the other", () => {
    expect(highlightAt([big, small], 0.35, 0.23)?.id).toBe("small");
    expect(highlightAt([small, big], 0.35, 0.23)?.id).toBe("small");
    expect(highlightAt([big, small], 0.7, 0.25)?.id).toBe("big");
  });
});

describe("a selection's words", () => {
  it("are one line, with a word broken at a line's end put back together", () => {
    expect(selectedWords("the reader's  own com-\nmonplace book\nfor this novel ")).toBe("the reader's own commonplace book for this novel");
  });

  it("keep a hyphen that is the word's own", () => {
    expect(selectedWords("a well-\nKnown name and a self-made one")).toBe("a well- Known name and a self-made one");
  });
});
