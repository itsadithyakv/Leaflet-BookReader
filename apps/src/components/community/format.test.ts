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

describe("what is said of an error", () => {
  it("calls a part the server has not got yet coming soon, and passes the rest through", async () => {
    const { COMING_SOON, errorText, gentleError, notThereYet } = await import("./format");
    // The server's own answer for a path it does not have.
    expect(errorText(new Error("Not found."))).toBe(COMING_SOON);
    expect(errorText("Not found.")).toBe(COMING_SOON);
    expect(gentleError("Not found.")).toBe(COMING_SOON);
    expect(notThereYet("Not found.")).toBe(true);
    expect(notThereYet(COMING_SOON)).toBe(true);
    // A thing it has not got is a real answer, said as it came.
    expect(errorText(new Error("No shared profile with that handle."))).toBe("No shared profile with that handle.");
    expect(notThereYet("No shared profile with that handle.")).toBe(false);
    expect(errorText(new Error("Too many requests. Try again in a minute."))).toBe("Too many requests. Try again in a minute.");
  });
});

