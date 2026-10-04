import { describe, expect, it } from "vitest";
import { nameToEdit } from "./format";

describe("the name a profile is edited with", () => {
  it("starts from the sign-up name while the profile is being set up", () => {
    expect(nameToEdit(null, "Ada Lovelace")).toBe("Ada Lovelace");
    expect(nameToEdit({ handle: null, displayName: null }, "Ada Lovelace")).toBe("Ada Lovelace");
    expect(nameToEdit({ handle: null, displayName: null }, null)).toBe("");
  });

  it("is the profile's own once it has one", () => {
    expect(nameToEdit({ handle: "ada", displayName: "Ada" }, "Ada Lovelace")).toBe("Ada");
  });

  it("stays empty for a reader who removed their name", () => {
    // Shared as @ada with no name. Filled back in from the account, the field
    // put "Ada Lovelace" on the board the next time the profile was saved.
    expect(nameToEdit({ handle: "ada", displayName: null }, "Ada Lovelace")).toBe("");
  });
});
