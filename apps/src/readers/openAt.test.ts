import { describe, expect, it } from "vitest";
import { LOOK_MS, placeFollows } from "./openAt";

describe("a book opened at a highlight", () => {
  it("saves the place as usual in an ordinary visit", () => {
    expect(placeFollows(false, 0)).toBe(true);
    expect(placeFollows(false, 5_000)).toBe(true);
  });

  it("leaves the saved place alone while it is a look", () => {
    expect(placeFollows(true, 0)).toBe(false);
    expect(placeFollows(true, 30_000)).toBe(false);
    expect(placeFollows(true, LOOK_MS - 1)).toBe(false);
  });

  it("follows the reader once they have stayed", () => {
    expect(placeFollows(true, LOOK_MS)).toBe(true);
    expect(placeFollows(true, 10 * 60_000)).toBe(true);
  });
});
