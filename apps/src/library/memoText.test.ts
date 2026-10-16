import { describe, expect, it, vi } from "vitest";
import { memoText } from "./memoText";

describe("memoText", () => {
  it("answers as the function does, working each text out once", () => {
    const upper = vi.fn((text: string) => text.toUpperCase());
    const memo = memoText(upper);
    expect(memo("night")).toBe("NIGHT");
    expect(memo("night")).toBe("NIGHT");
    expect(memo("")).toBe("");
    expect(memo("")).toBe("");
    expect(upper).toHaveBeenCalledTimes(2);
  });

  it("starts again past its cap, and still answers rightly", () => {
    const fn = vi.fn((text: string) => `${text}!`);
    const memo = memoText(fn, 2);
    memo("a");
    memo("b");
    memo("c");
    expect(memo("c")).toBe("c!");
    expect(memo("a")).toBe("a!");
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
