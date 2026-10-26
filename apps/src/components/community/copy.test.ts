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

describe("finding readers", () => {
  it("names the follow button's three states, and only says that a reader follows you", async () => {
    const { followLabel, relationText } = await import("./copy");
    expect([followLabel("none"), followLabel("requested"), followLabel("following")]).toEqual(["Follow", "Requested", "Following"]);
    expect(relationText(true, true)).toBe("Follows you");
    expect(relationText(false, true)).toBe("Follows you");
    expect(relationText(true, false)).toBeNull();
  });

  it("says why a reader is suggested, naming a reader you follow only where the server did", async () => {
    const { reasonText } = await import("./copy");
    expect(reasonText({ kind: "book", title: "Dune" })).toBe("Posted about Dune");
    const via = { handle: "ana", displayName: null, pipSeed: "ana" };
    expect(reasonText({ kind: "follows", count: 1, via })).toBe("Followed by @ana");
    expect(reasonText({ kind: "follows", count: 3, via })).toBe("Followed by @ana and 2 more");
    expect(reasonText({ kind: "follows", count: 1, via: null })).toBe("Followed by a reader you follow");
    expect(reasonText({ kind: "follows", count: 4, via: null })).toBe("Followed by 4 readers you follow");
  });

  it("explains kudos in one line, and the People tab is where readers are found", async () => {
    const { PEOPLE_PLACE } = await import("./copy");
    expect(COPY.kudosExplained).toBe("A daily pat on the back. One a day per reader; it doesn't cost or buy anything.");
    expect(PEOPLE_PLACE).toBe("Social → People");
  });
});
