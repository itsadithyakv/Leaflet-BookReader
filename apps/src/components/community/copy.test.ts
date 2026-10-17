import { describe, expect, it } from "vitest";
import { COPY, PROFILE_PLACE, kudosReceivedText } from "./copy";

describe("kudos in the inbox", () => {
  it("say what they were for when they were for a post", () => {
    expect(kudosReceivedText("ana")).toBe("@ana sent you kudos.");
    expect(kudosReceivedText("ana", { kind: "finished", title: "Dune" })).toBe("@ana sent you kudos for finishing Dune.");
    expect(kudosReceivedText("ana", { kind: "review", title: "Dune" })).toBe("@ana sent you kudos for your review of Dune.");
    expect(kudosReceivedText("ana", { kind: "quote", title: "Dune" })).toBe("@ana sent you kudos for your quote from Dune.");
  });
});

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
