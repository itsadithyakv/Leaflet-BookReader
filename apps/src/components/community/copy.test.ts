import { describe, expect, it } from "vitest";
import { COPY, PROFILE_PLACE } from "./copy";

describe("where a reader's own profile is", () => {
  it("is the You card on the Board tab", () => {
    expect(PROFILE_PLACE).toBe("Social → Board → You");
  });

  it("goes by that one name in every sentence that sends a reader there", () => {
    for (const sentence of [COPY.shareAtSignUp, COPY.privateAtSignUp, COPY.shareLater]) {
      expect(sentence).toContain(`under ${PROFILE_PLACE}.`);
    }
    // The names it used to go by: a tab that was renamed, and a path with the tab left out.
    for (const sentence of Object.values(COPY)) {
      expect(sentence).not.toMatch(/Social → (You|Community)/);
    }
  });
});
