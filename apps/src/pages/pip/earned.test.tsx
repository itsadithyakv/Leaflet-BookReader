import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SKINS } from "../../pip";
import type { ShopKind } from "../../pip/shop";
import type { EarnStatus } from "../../services/pipService";
import { earnedHint, earnedProgress, markEarnedSeen, newlyEarned } from "./earned";
import { pipThingsTabs } from "./thingsTabs";

// The sprite draws on a canvas, which a test has none of: the tiles are what is under test.
vi.mock("../../components/PipSprite", () => ({ PipSprite: () => null }));

const status = (id: string, value: number, target: number, unit: string, done = value >= target): EarnStatus => ({
  kind: "skin",
  id,
  done,
  earnable: true,
  value,
  target,
  unit
});

/** A storage that keeps what it is given, as localStorage would. */
const memory = () => {
  const kept = new Map<string, string>();
  return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) };
};

/** The Looks tab's markup for a reader who owns `owned` ("kind:id"), with these earned statuses. */
const looks = (owned: string[], earned: EarnStatus[]) => {
  const never = () => undefined;
  const tally = { owned: 0, total: 0 };
  const tabs = pipThingsTabs({
    owns: (kind: ShopKind, id: string) => owned.includes(`${kind}:${id}`),
    variant: "sprout",
    outfit: [],
    skin: SKINS.find((skin) => skin.id === "sprout"),
    shownVariant: "sprout",
    signature: "read",
    wearing: () => false,
    withAccessory: (id) => [id],
    tallies: { variants: tally, wardrobe: tally, treats: tally, moves: tally },
    earned,
    moveList: [],
    spendable: 0,
    change: async () => undefined,
    give: async () => undefined,
    play: never,
    openShop: never,
    showToast: never
  });
  return renderToStaticMarkup(<>{tabs.find((tab) => tab.id === "looks")?.body}</>);
};

/** The markup of the group with this title, up to the next group. */
const group = (markup: string, title: string) => {
  const from = markup.indexOf(`${title}<`);
  expect(from).toBeGreaterThan(-1);
  const next = markup.indexOf("uppercase tracking", from + title.length);
  return markup.slice(from, next === -1 ? undefined : next);
};

describe("things earned by reading", () => {
  it("says how far along a locked one is, in the unlock's own unit", () => {
    expect(earnedProgress(status("autumn", 5, 7, "days"))).toBe("5/7 days");
    expect(earnedProgress(status("ink", 42.9, 100, "hours"))).toBe("42/100 hours");
    expect(earnedProgress(status("golden", 400, 365, "days", false))).toBe("365/365 days");
    expect(earnedProgress(status("autumn", 7, 7, "days"))).toBeNull();
    expect(earnedProgress(status("ghost", 0, 1, ""))).toBeNull();
    expect(earnedProgress({ ...status("cyclist", 0, 1, ""), earnable: false })).toBeNull();
    expect(earnedHint("Keep a 7-day streak.", status("autumn", 5, 7, "days"))).toBe("Keep a 7-day streak. 5/7 days");
    expect(earnedHint("Read on Halloween.", status("ghost", 0, 1, ""))).toBe("Read on Halloween.");
  });

  it("shows an earned skin with the ones to wear, and a locked one with its progress", () => {
    const earned = [status("autumn", 8, 7, "days"), status("sakura", 8, 30, "days"), status("bookworm", 2, 5, "books")];
    const markup = looks(["skin:sprout", "skin:autumn"], earned);
    const variants = group(markup, "Variants");
    const locked = group(markup, "Earned by reading");
    expect(variants).toContain('aria-label="Maple. Select to wear it."');
    expect(locked).not.toContain("Maple");
    expect(locked).toContain('title="Keep a 30-day streak. 8/30 days"');
    expect(locked).toContain('title="Finish 5 books. 2/5 books"');
    expect(locked).toContain("Locked. Earned by reading: Keep a 30-day streak. 8/30 days");
  });

  it("shows off each thing earned once on a device", () => {
    const store = memory();
    const earned = [status("autumn", 8, 7, "days"), status("sakura", 8, 30, "days")];
    expect(newlyEarned(earned, store).map((entry) => entry.id)).toEqual(["autumn"]);
    markEarnedSeen(newlyEarned(earned, store), store);
    expect(newlyEarned(earned, store)).toEqual([]);
    const later = [status("autumn", 30, 7, "days"), status("sakura", 30, 30, "days")];
    expect(newlyEarned(later, store).map((entry) => entry.id)).toEqual(["sakura"]);
    expect(newlyEarned(undefined, store)).toEqual([]);
  });

  it("never nags when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    };
    expect(newlyEarned([status("autumn", 8, 7, "days")], blocked)).toEqual([]);
    expect(newlyEarned([status("autumn", 8, 7, "days")], null)).toEqual([]);
  });
});
