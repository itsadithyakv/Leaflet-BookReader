import { describe, expect, it } from "vitest";
import { badgeInfo, progressText, shownBadges } from "./badges";

describe("badges, in words", () => {
  it("names the fixed ones and the months", () => {
    expect(badgeInfo("streak-30")).toMatchObject({ name: "A month of it", earnedBy: "Read 30 days in a row", tier: 2 });
    expect(badgeInfo("month-2026-10-500")).toMatchObject({
      kind: "month",
      name: "October 2026",
      earnedBy: "Read 500 minutes in October 2026",
      tier: 2
    });
    expect(badgeInfo("month-2026-10-1000")).toMatchObject({ name: "October 2026, doubled", earnedBy: "Read 1,000 minutes in October 2026", tier: 3 });
  });

  it("shows nothing for an id it does not know", () => {
    // A newer app's badge, a month that is not one, a typo.
    expect(badgeInfo("streak-9000")).toBeNull();
    expect(badgeInfo("month-2026-13-500")).toBeNull();
    expect(badgeInfo("month-2026-10-750")).toBeNull();
    expect(shownBadges(["streak-9000", "books-1"]).map((badge) => badge.id)).toEqual(["books-1"]);
    expect(shownBadges(null)).toEqual([]);
  });

  it("puts the hardest first, and otherwise keeps the order given", () => {
    const ids = ["streak-7", "hours-10", "books-100", "streak-30", "month-2026-10-1000"];
    expect(shownBadges(ids).map((badge) => badge.id)).toEqual(["books-100", "month-2026-10-1000", "streak-30", "streak-7", "hours-10"]);
    expect(shownBadges(ids, 2).map((badge) => badge.id)).toEqual(["books-100", "month-2026-10-1000"]);
  });

  it("says how far along a badge is in its own unit", () => {
    expect(progressText("streak", 23.9, 30)).toBe("23 of 30 days");
    expect(progressText("month", 1234.5, 1000)).toBe("1,234 of 1,000 minutes");
    expect(progressText("arcade", 37, 100)).toBe("Best 37 of 100");
  });
});
