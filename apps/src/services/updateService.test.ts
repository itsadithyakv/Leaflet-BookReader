import { describe, expect, it } from "vitest";
import { isNewer, versionParts } from "./updateService";

describe("whether a newer Leaflet is out", () => {
  it("reads a version as its numbers", () => {
    expect(versionParts("1.4.2")).toEqual([1, 4, 2]);
    expect(versionParts(" v1.4 ")).toEqual([1, 4]);
    expect(versionParts("1.4.2-beta")).toBeNull();
    expect(versionParts("")).toBeNull();
    expect(versionParts(null)).toBeNull();
  });

  it("compares part by part, a missing part as nought", () => {
    expect(isNewer("1.4.2", "1.4.0")).toBe(true);
    expect(isNewer("1.5", "1.4.9")).toBe(true);
    expect(isNewer("1.10.0", "1.9.9")).toBe(true);
    expect(isNewer("2.0.0", "1.99.99")).toBe(true);
    expect(isNewer("1.4.2", "1.4.2")).toBe(false);
    expect(isNewer("1.4", "1.4.0")).toBe(false);
    expect(isNewer("1.4.1", "1.4.2")).toBe(false);
  });

  it("never says so when either will not read", () => {
    expect(isNewer(null, "1.4.2")).toBe(false);
    expect(isNewer("9.9.9", null)).toBe(false);
    expect(isNewer("soon", "1.4.2")).toBe(false);
  });
});
