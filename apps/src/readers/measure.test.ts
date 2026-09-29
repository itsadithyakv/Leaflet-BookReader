import { afterEach, describe, expect, it, vi } from "vitest";
import { MEASURE_KEY, measureCss, pagesViewerMaxWidth, readMeasure } from "./readerTypes";

describe("line length", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const storage = (value: string | null) => ({ getItem: (key: string) => (key === MEASURE_KEY ? value : null) });

  it("is a comfortable column unless the reader chose otherwise", () => {
    vi.stubGlobal("localStorage", storage(null));
    expect(readMeasure()).toBe("medium");
    vi.stubGlobal("localStorage", storage("wide"));
    expect(readMeasure()).toBe("wide");
    vi.stubGlobal("localStorage", storage("something old"));
    expect(readMeasure()).toBe("medium");
  });

  it("measures the column in the reading size, so bigger type keeps its characters a line", () => {
    expect(measureCss("medium")).toBe("34em");
    expect(measureCss("full")).toBe("100vw");
    expect(pagesViewerMaxWidth("medium", 18)).toBe(34 * 18 + 96);
    expect(pagesViewerMaxWidth("medium", 24)).toBeGreaterThan(pagesViewerMaxWidth("medium", 18) as number);
    expect(pagesViewerMaxWidth("full", 18)).toBeNull();
  });
});
