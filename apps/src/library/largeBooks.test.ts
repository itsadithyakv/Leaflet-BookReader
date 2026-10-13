import { describe, expect, it } from "vitest";
import { largeBookQuestion, sizeText } from "./largeBooks";

const MB = 1024 * 1024;
const book = (title: string, mb: number) => ({ id: title, title, bytes: mb * MB, backUp: null });

describe("asking before a large file is backed up", () => {
  it("says a size the way a reader would", () => {
    expect(sizeText(43_536_580)).toBe("42 MB");
    expect(sizeText(10 * MB + 1)).toBe("10 MB");
    expect(sizeText(1024 * MB)).toBe("1 GB");
    expect(sizeText(1300 * MB)).toBe("1.3 GB");
  });

  it("names the one book and its size", () => {
    // The reported case.
    const question = largeBookQuestion([book("Ancient India", 41.5)]);
    expect(question.title).toBe("Back up “Ancient India”?");
    expect(question.body).toMatch(/^Its file is 42 MB\. Your place, notes and highlights are backed up either way/);
    expect(question.confirmLabel).toBe("Back up the file");
    expect(question.cancelLabel).toBe("Not this one");
  });

  it("asks about several at once, with what they come to", () => {
    const two = largeBookQuestion([book("Atlas", 60), book("Ancient India", 42)]);
    expect(two.title).toBe("Back up 2 large books?");
    expect(two.body).toMatch(/^Atlas \(60 MB\) and Ancient India \(42 MB\): 102 MB in all\./);
    const five = largeBookQuestion([book("A", 50), book("B", 40), book("C", 30), book("D", 20), book("E", 11)]);
    expect(five.body).toMatch(/^A \(50 MB\), B \(40 MB\) and 3 more: 151 MB in all\./);
    expect(five.cancelLabel).toBe("Not these");
  });
});
