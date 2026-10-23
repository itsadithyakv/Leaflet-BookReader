import { describe, expect, it } from "vitest";
import { FIRST_OUT_MS, firstOutDelay } from "./firstOut";

describe("firstOutDelay", () => {
  it("is the whole wait without a start", () => {
    expect(firstOutDelay(undefined, 5000)).toBe(FIRST_OUT_MS);
  });

  it("is what is left of it since the app started", () => {
    expect(firstOutDelay(1000, 1600)).toBe(FIRST_OUT_MS - 600);
  });

  it("is nothing once the wait has passed", () => {
    expect(firstOutDelay(1000, 1000 + FIRST_OUT_MS + 300)).toBe(0);
  });

  it("is never longer than the whole wait (a start time from later)", () => {
    expect(firstOutDelay(2000, 1500)).toBe(FIRST_OUT_MS);
  });
});
