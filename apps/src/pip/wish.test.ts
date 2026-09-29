import { describe, expect, it } from "vitest";
import { dayHash, grantedLine, wishLine, wishView, withArticle } from "./wish";
import { WISH, catalogueItem } from "./shop";
import type { WishStatus } from "../services/pipService";

const wish = (over: Partial<WishStatus> = {}): WishStatus => ({
  day: "2026-10-02",
  kind: "treat",
  id: "cookie",
  granted: false,
  seeds: WISH.seeds,
  mood: WISH.mood,
  ...over
});

describe("Pip's wish, in Pip's words", () => {
  it("says the same line all day, and may say another tomorrow", () => {
    expect(wishLine("treat", "Cookie", "2026-10-02")).toBe(wishLine("treat", "Cookie", "2026-10-02"));
    const lines = new Set(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"].map((day) => wishLine("treat", "Cookie", day)));
    expect(lines.size).toBeGreaterThan(1);
  });

  it("is short and lowercase, with the right article", () => {
    const line = wishLine("treat", "Apple", "2026-10-02");
    expect(line).toBe(line.toLowerCase());
    expect(line).toContain("an apple");
    expect(withArticle("Floor Lamp")).toBe("a floor lamp");
    expect(withArticle("Ice Cream")).toBe("an ice cream");
  });

  it("names a move without an article", () => {
    expect(wishLine("move", "Floss", "2026-10-02")).toMatch(/the floss/);
  });

  it("thanks the reader the same way all day", () => {
    expect(grantedLine("2026-10-02")).toBe(grantedLine("2026-10-02"));
    expect(grantedLine("2026-10-02")).toBe(grantedLine("2026-10-02").toLowerCase());
  });

  it("hashes like FNV-1a, the hash Rust picks the wish with", () => {
    expect(dayHash("")).toBe(0x811c9dc5);
    // The standard FNV-1a (32-bit) test vector.
    expect(dayHash("a")).toBe(0xe40c292c);
  });
});

describe("what granting it takes", () => {
  it("prices it from the catalogue and says how many seeds are missing", () => {
    const price = catalogueItem("treat", "cookie")?.price ?? 0;
    const view = wishView(wish(), price - 3);
    expect(view?.price).toBe(price);
    expect(view?.short).toBe(3);
    expect(view?.action).toBe("give");
    expect(wishView(wish(), 1000)?.short).toBe(0);
  });

  it("needs nothing more once granted", () => {
    expect(wishView(wish({ granted: true }), 0)?.short).toBe(0);
  });

  it("asks for a free plot for a seed packet", () => {
    const full = { plots: 1, plants: [{ id: "p", plot: 1, plant: "oak", water: 0, need: 600, ripe: false, harvested: false, seeds: 0 }] };
    expect(wishView(wish({ kind: "plant", id: "radish" }), 99, full)?.needsPlot).toBe(true);
    expect(wishView(wish({ kind: "plant", id: "radish" }), 99, { plots: 2, plants: full.plants })?.needsPlot).toBe(false);
    expect(wishView(wish({ kind: "plant", id: "radish" }), 99, full)?.action).toBe("plant");
  });

  it("sends decor and moves to the shop", () => {
    expect(wishView(wish({ kind: "room", id: "lamp" }), 0)?.action).toBe("shop");
    expect(wishView(wish({ kind: "move", id: "floss" }), 0)?.action).toBe("shop");
  });

  it("shows nothing without a wish, or for one this build does not know", () => {
    expect(wishView(null, 10)).toBeNull();
    expect(wishView(wish({ id: "caviar" }), 10)).toBeNull();
  });

  it("wishes only for things on sale in every build", () => {
    for (const era of WISH.eras) {
      for (const kind of ["treat", "plant", "room", "move"] as const) {
        for (const id of era[kind]) expect(catalogueItem(kind, id), `${kind} ${id}`).not.toBeNull();
      }
    }
  });
});
