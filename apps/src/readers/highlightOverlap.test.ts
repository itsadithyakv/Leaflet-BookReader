import { describe, expect, it } from "vitest";
import { covers, highlightsUnder, joinNotes, overlaps } from "./highlightOverlap";

const TEXT = "The ferry left at nine and the tide was low. Nobody waved.";

/**
 * As much of a `Range` as is used: its two ends in one text, compared the way
 * the DOM compares them (`how` names the end of the range passed in, then the
 * end of this one).
 */
const page = (text = TEXT) => {
  const node = { ownerDocument: { text } };
  const make = (from: number, to: number): Range => {
    const range = {
      startContainer: node,
      endContainer: node,
      startOffset: from,
      endOffset: to,
      compareBoundaryPoints(how: number, other: Range) {
        const mine = how === 0 || how === 3 ? this.startOffset : this.endOffset;
        const theirs = how === 0 || how === 1 ? other.startOffset : other.endOffset;
        return Math.sign(mine - theirs);
      },
      setStart(_node: unknown, offset: number) {
        this.startOffset = offset;
      },
      setEnd(_node: unknown, offset: number) {
        this.endOffset = offset;
      },
      cloneRange() {
        return make(this.startOffset, this.endOffset);
      },
      toString() {
        return text.slice(this.startOffset, this.endOffset);
      }
    };
    return range as unknown as Range;
  };
  return (words: string) => {
    const from = text.indexOf(words);
    return make(from, from + words.length);
  };
};

describe("a selection over highlighted words", () => {
  it("knows words shared from words that only meet", () => {
    const range = page();
    expect(overlaps(range("ferry left"), range("left at"))).toBe(true);
    expect(overlaps(range("left at"), range("ferry left"))).toBe(true);
    expect(overlaps(range("The ferry"), range(" left at"))).toBe(false);
    expect(overlaps(range("The ferry"), range("Nobody"))).toBe(false);
    expect(covers(range("ferry left at nine"), range("left at"))).toBe(true);
    expect(covers(range("left at"), range("left at"))).toBe(true);
    expect(covers(range("left at"), range("ferry left at"))).toBe(false);
    // Another chapter's document: never the same words.
    expect(overlaps(range("ferry left"), page()("ferry left"))).toBe(false);
  });

  it("is the highlight it lies inside, and adds nothing", () => {
    const range = page();
    const laid = [
      { id: "a", range: range("ferry left at nine") },
      { id: "b", range: range("Nobody waved") }
    ];
    const under = highlightsUnder(range("left at"), laid);
    expect(under.over.map((one) => one.id)).toEqual(["a"]);
    expect(under.within?.id).toBe("a");
    // The same words again are inside it too.
    expect(highlightsUnder(range("ferry left at nine"), laid).within?.id).toBe("a");
  });

  it("grows over every highlight it touches", () => {
    const range = page();
    const laid = [
      { id: "a", range: range("ferry left") },
      { id: "b", range: range("tide was low.") },
      { id: "c", range: range("waved") }
    ];
    const picked = range("left at nine and the tide");
    const under = highlightsUnder(picked, laid);
    expect(under.over.map((one) => one.id)).toEqual(["a", "b"]);
    expect(under.within).toBeNull();
    expect(under.whole.toString()).toBe("ferry left at nine and the tide was low.");
    // The selection itself is left as it was.
    expect(picked.toString()).toBe("left at nine and the tide");
  });

  it("touches nothing where nothing is highlighted", () => {
    const range = page();
    const under = highlightsUnder(range("the tide"), [{ id: "a", range: range("ferry left") }]);
    expect([under.over, under.within, under.whole.toString()]).toEqual([[], null, "the tide"]);
  });

  it("keeps each note once", () => {
    expect(joinNotes(["first", null, " ", "second", "first"])).toBe("first\n\nsecond");
    expect(joinNotes([null, undefined, ""])).toBeNull();
  });
});
