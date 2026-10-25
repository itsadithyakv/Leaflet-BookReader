import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

/** The browser preview keeps cards in its own storage, by the same rules as the app's database. */
describe("study cards in the browser preview", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key)
    });
  });

  it("are made, reviewed, removed as tombstones and put back as they were", async () => {
    const { cardService } = await import("./cardService");
    const { fillInput, askInput } = await import("../study/cards");
    const place = { bookId: "b1", cfi: "epubcfi(/6/8!/4/2)", chapter: "The heart", p: 0.2 };
    await cardService.save([fillInput(place, "The mitral valve has two cusps.", [[4, 10]], null, "card:f"), askInput(place, "Why?", "Because.", null, "card:a")]);
    expect((await cardService.list()).map((card) => card.id).sort()).toEqual(["card:a", "card:f"]);

    await cardService.review([{ id: "card:f", box: 2, due: 20_400 }]);
    await cardService.remove(["card:f"]);
    expect((await cardService.list()).map((card) => card.id)).toEqual(["card:a"]);
    const kept = JSON.parse(localStorage.getItem("leaflet.cards.preview") ?? "[]");
    expect(kept.find((row: { id: string }) => row.id === "card:f").deletedAt).toBeTruthy();

    const back = await cardService.restore(["card:f"]);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: "card:f", box: 2, due: 20_400, kind: "fill" });
    expect((await cardService.list()).map((card) => card.id).sort()).toEqual(["card:a", "card:f"]);
    await expect(cardService.review([{ id: "card:nothing", box: 1, due: 20_400 }])).rejects.toThrow();
  });
});
