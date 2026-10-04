import { describe, expect, it } from "vitest";
import { planHighlightDraws } from "./highlightDraws";

const A = "epubcfi(/6/26!/4/10,/1:0,/1:20)";
const B = "epubcfi(/6/26!/4/12,/1:4,/1:30)";

describe("drawing highlights on the page", () => {
  it("draws what is wanted and not yet drawn", () => {
    expect(planHighlightDraws(new Map(), [{ key: "1|yellow", cfi: A }, { key: "2|green", cfi: B }])).toEqual({
      remove: [],
      draw: ["1|yellow", "2|green"]
    });
    expect(planHighlightDraws(new Map([["1|yellow", A]]), [{ key: "1|yellow", cfi: A }, { key: "2|green", cfi: B }])).toEqual({
      remove: [],
      draw: ["2|green"]
    });
  });

  it("takes off what is no longer wanted", () => {
    expect(planHighlightDraws(new Map([["1|yellow", A], ["2|green", B]]), [{ key: "2|green", cfi: B }])).toEqual({
      remove: ["1|yellow"],
      draw: []
    });
  });

  it("redraws a recoloured highlight", () => {
    expect(planHighlightDraws(new Map([["1|yellow", A]]), [{ key: "1|pink", cfi: A }])).toEqual({
      remove: ["1|yellow"],
      draw: ["1|pink"]
    });
  });

  it("draws one mark for two highlights of the same words", () => {
    expect(planHighlightDraws(new Map(), [{ key: "1|yellow", cfi: A }, { key: "2|green", cfi: A }])).toEqual({
      remove: [],
      draw: ["1|yellow"]
    });
    // Already drawn: the second is not added on top of it.
    expect(planHighlightDraws(new Map([["1|yellow", A]]), [{ key: "1|yellow", cfi: A }, { key: "2|green", cfi: A }])).toEqual({
      remove: [],
      draw: []
    });
  });

  it("gives the place to the other highlight when the drawn one is removed", () => {
    expect(planHighlightDraws(new Map([["1|yellow", A]]), [{ key: "2|green", cfi: A }])).toEqual({
      remove: ["1|yellow"],
      draw: ["2|green"]
    });
    // And nothing is left on the page when both have gone.
    expect(planHighlightDraws(new Map([["2|green", A]]), [])).toEqual({ remove: ["2|green"], draw: [] });
  });
});
