import { describe, expect, it } from "vitest";
import { cleanHandle, handleProblem, suggestHandle } from "./handle";
import { at } from "./format";

describe("a handle as typed", () => {
  it("never keeps the @ it is shown with", () => {
    expect(cleanHandle("@maya_reads")).toBe("maya_reads");
    expect(cleanHandle("  @@Maya_Reads ")).toBe("maya_reads");
    // Pasted from an invite: "Add me on Leaflet: @maya".
    expect(cleanHandle("@maya")).toBe("maya");
    // What is stored and sent has no @; what is shown always has one.
    expect(at(cleanHandle("@maya"))).toBe("@maya");
    expect(cleanHandle("")).toBe("");
  });

  it("is cut to the longest a handle can be, after the @ is gone", () => {
    expect(cleanHandle(`@${"a".repeat(30)}`)).toBe("a".repeat(24));
  });
});

describe("whether a handle can be used", () => {
  it("follows the server's rule", () => {
    for (const fine of ["adi", "maya_reads", "a-b", "reader2026", "a".repeat(24)]) {
      expect(handleProblem(fine)).toBeNull();
    }
    expect(handleProblem("ab")).toMatch(/3–24 characters/);
    expect(handleProblem("")).toMatch(/3–24 characters/);
    expect(handleProblem("ada lovelace")).toMatch(/3–24 characters/);
    expect(handleProblem("ünï")).toMatch(/3–24 characters/);
    expect(handleProblem("@adi")).toMatch(/3–24 characters/);
    expect(handleProblem("a".repeat(25))).toMatch(/3–24 characters/);
    expect(handleProblem("_adi")).toMatch(/starts and ends/);
    expect(handleProblem("adi-")).toMatch(/starts and ends/);
  });
});

describe("the handle suggested at sign-up", () => {
  it("comes from the name, else from the email", () => {
    expect(suggestHandle("Ada Lovelace", "ada@example.com")).toBe("ada_lovelace");
    expect(suggestHandle("", "maya.reads+books@example.com")).toBe("maya_reads_books");
    expect(suggestHandle("  ", "adi@example.com")).toBe("adi");
    // A name with nothing usable in it falls through to the email.
    expect(suggestHandle("李", "li.wei@example.com")).toBe("li_wei");
  });

  it("is always one the rule accepts, or nothing", () => {
    expect(suggestHandle("", "")).toBe("");
    expect(suggestHandle("A", "b@example.com")).toBe("");
    const long = suggestHandle("Bartholomew Maximilian Fitzgerald-Montgomery", "b@example.com");
    expect(long.length).toBeLessThanOrEqual(24);
    expect(handleProblem(long)).toBeNull();
    expect(handleProblem(suggestHandle("Zoë  d'Arc!!", "z@example.com"))).toBeNull();
  });
});
