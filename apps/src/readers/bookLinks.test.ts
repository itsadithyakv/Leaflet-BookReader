import { describe, expect, it } from "vitest";
import { isOutsideLink, resolveBookLink } from "./bookLinks";

describe("links inside a book", () => {
  it("reads a link from the file it is written in", () => {
    expect(resolveBookLink("notes.xhtml#en3", "ch2.xhtml")).toEqual({ path: "notes.xhtml", id: "en3", href: "notes.xhtml#en3" });
    expect(resolveBookLink("../Text/notes.html#n1", "Text/ch2.html")).toEqual({
      path: "Text/notes.html",
      id: "n1",
      href: "Text/notes.html#n1"
    });
    expect(resolveBookLink("ch1.xhtml", "ch2.xhtml")).toEqual({ path: "ch1.xhtml", id: "", href: "ch1.xhtml" });
  });

  it("keeps a link to a place in the same file in that file", () => {
    expect(resolveBookLink("#fn1", "Text/ch2.xhtml")).toEqual({ path: "Text/ch2.xhtml", id: "fn1", href: "Text/ch2.xhtml#fn1" });
  });

  it("gives names as the book writes them, not escaped", () => {
    expect(resolveBookLink("chapter%20one.html#a%20b", "Text/ch2.html")?.path).toBe("Text/chapter one.html");
    expect(resolveBookLink("chapter%20one.html#a%20b", "Text/ch2.html")?.id).toBe("a b");
    // A stray percent sign is left as it is.
    expect(resolveBookLink("100%.html", "ch2.html")?.path).toBe("100%.html");
  });

  it("does not climb out of the book", () => {
    expect(resolveBookLink("../../../etc/notes.html", "Text/ch2.html")?.path).toBe("etc/notes.html");
    expect(resolveBookLink("//example.com/x.html", "ch2.html")).toBeNull();
  });

  it("leaves links that go elsewhere alone", () => {
    expect(isOutsideLink("https://example.com/")).toBe(true);
    expect(isOutsideLink("mailto:someone@example.com")).toBe(true);
    expect(isOutsideLink("notes.xhtml#n1")).toBe(false);
    expect(resolveBookLink("https://example.com/", "ch2.html")).toBeNull();
    expect(resolveBookLink("mailto:someone@example.com", "ch2.html")).toBeNull();
    expect(resolveBookLink("  ", "ch2.html")).toBeNull();
  });
});
