import { describe, expect, it } from "vitest";
import { loadNods, nodsNow } from "./nods";

describe("the table of Pip's nods, fetched when first wanted", () => {
  it("is not here until someone has asked for it, and then is", async () => {
    expect(nodsNow()).toBeNull();
    const asked = loadNods();
    // Asked for twice before it has come: one fetch.
    expect(loadNods()).toBe(asked);
    const nods = await asked;
    expect(nodsNow()).toBe(nods);
    // The table itself: a book she knows, and one she does not.
    expect(nods.nodFor({ title: "Dune", author: "Frank Herbert" }, 1)?.known).toBe(true);
    expect(nods.nodFor({ title: "Quarterly Accounts 2019", author: "Nobody" }, 1)).toBeNull();
    // Asked for again once it is here: the same table, at once.
    expect(await loadNods()).toBe(nods);
  });
});
