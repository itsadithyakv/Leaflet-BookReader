import { describe, expect, it } from "vitest";
import { chapterStartsAt } from "./chapters";
import { FAR, FAR_SHOWN, KING_TARGET, MAIN_STRONGHOLDS, REGION_CHAPTER, REGION_NAMES, landsOf, markScouted, progressLine, raidOf, strongholdName, totalsOf } from "./lands";
import { bestStars, finishRaid, newBase, raidForecast, rematchOf, replayLoot, replayPick, settle, startRaid, type BaseState, type Now } from "./rules";

const DAY = "2026-10-24";
const H = 60;
const at = (minutes: number, day = DAY): Now => ({ minutes, day, lit: false });
/** A camp at a chapter, with its hut built and rested for raids. */
const campAt = (chapter: number, camps = 0, more: Partial<BaseState> = {}): BaseState => {
  const minutes = chapterStartsAt(chapter);
  const base = settle(newBase(0, DAY), at(minutes));
  return { ...base, camps, raidFrom: 0, levels: { ...base.levels, hut: Math.max(1, base.levels.hut) }, ...more };
};

describe("the Magpie Lands: the map", () => {
  it("has five regions of three strongholds, the third of each a lord's keep, under the strongholds' names", () => {
    const lands = landsOf(campAt(10, 0), at(chapterStartsAt(10)));
    expect(lands.regions.map((region) => region.name)).toEqual(REGION_NAMES);
    expect(REGION_NAMES[0]).toBe("The Twig Nest woods");
    expect(lands.nodes).toHaveLength(MAIN_STRONGHOLDS);
    expect(lands.nodes.filter((node) => node.kind === "keep").map((node) => node.n)).toEqual([2, 5, 8, 11, 14]);
    expect(lands.nodes[5]).toMatchObject({ name: "Bramble Keep", region: 1, lordName: "The Bramble Baron" });
    expect(lands.nodes.every((node, n) => node.region === Math.floor(n / 3))).toBe(true);
  });

  it("shows each stronghold's best stars, and those taken before stars were kept as taken without any", () => {
    const base = campAt(5, 6, { strongholds: { stars: [3, 2, 0, 1], scouted: [] } });
    const lands = landsOf(base, at(base.minutes));
    expect(lands.nodes.slice(0, 7).map((node) => node.stars)).toEqual([3, 2, null, 1, null, null, 0]);
    expect(lands.nodes.slice(0, 7).map((node) => node.taken)).toEqual([true, true, true, true, true, true, false]);
    expect(lands.nodes[6].next).toBe(true);
    // A keep taken flies its lord's pennant.
    expect(lands.nodes[2].pennant).toBe(true);
    expect(lands.nodes[8].pennant).toBe(false);
  });

  it("lies under fog past the chapter, lifting with the chapters that open raids and grow the hut", () => {
    expect(REGION_CHAPTER).toEqual([2, 3, 5, 7, 9]);
    const fogOf = (chapter: number, camps = 0) => landsOf(campAt(chapter, camps), at(chapterStartsAt(chapter))).regions.map((region) => region.fogged);
    expect(fogOf(2)).toEqual([false, true, true, true, true]);
    expect(fogOf(3)).toEqual([false, false, true, true, true]);
    expect(fogOf(7)).toEqual([false, false, false, false, true]);
    expect(fogOf(9)).toEqual([false, false, false, false, false]);
    // The next stronghold is never under fog, however far the scouts have got ahead of the reading.
    const ahead = landsOf(campAt(2, 4), at(chapterStartsAt(2)));
    expect(ahead.regions[1].fogged).toBe(false);
    expect(ahead.nodes[4]).toMatchObject({ next: true, fogged: false });
    // The King's peak comes with his chapter.
    expect(landsOf(campAt(9), at(chapterStartsAt(9))).roost.fogged).toBe(true);
    expect(landsOf(campAt(10), at(chapterStartsAt(10))).roost).toMatchObject({ fogged: false, lit: true });
  });

  it("lights the roost only in a month he can be fought, and flies every banner won", () => {
    const won = landsOf(campAt(10, 3, { banners: ["2026-10", "2026-08"] }), at(chapterStartsAt(10)));
    expect(won.roost).toMatchObject({ lit: false, closed: "won", banners: ["2026-08", "2026-10"] });
    const tried = landsOf(campAt(10, 3, { kingDay: DAY }), at(chapterStartsAt(10)));
    expect(tried.roost).toMatchObject({ lit: false, closed: "today" });
  });

  it("goes on into the Far Rookeries past stronghold 15, one numbered stronghold at a time", () => {
    expect(landsOf(campAt(10, 14), at(chapterStartsAt(10))).far.open).toBe(false);
    const far = landsOf(campAt(12, 23, { strongholds: { stars: Array(23).fill(2), scouted: [] } }), at(chapterStartsAt(12)));
    expect(far.far).toEqual({ open: true, taken: 8 });
    const farNodes = far.nodes.slice(MAIN_STRONGHOLDS);
    expect(farNodes.map((node) => node.n)).toEqual([23 - FAR_SHOWN, 22, 23]);
    expect(farNodes.every((node) => node.kind === "far" && node.region === FAR)).toBe(true);
    expect(farNodes[FAR_SHOWN]).toMatchObject({ name: "Far Rookery 24", next: true, taken: false });
    expect(strongholdName(15)).toBe("Far Rookery 16");
  });

  it("has no daily road camps (not played since 2026-10-15), and shows the friends' signpost on a yes", () => {
    const lands = landsOf(campAt(3, 2, { wild: { day: DAY, done: [1] } }), at(chapterStartsAt(3)), { friends: true });
    expect(lands.road).toEqual([]);
    expect(lands.friends).toBe(true);
    expect(landsOf(campAt(3, 2), at(chapterStartsAt(3))).friends).toBe(false);
  });

  it("says it all in one line, with the totals behind it", () => {
    const base = campAt(5, 7, { strongholds: { stars: [3, 3, 2, 3, 2, 3], scouted: [] }, banners: ["2026-09"] });
    const lands = landsOf(base, at(base.minutes));
    expect(lands.progress).toBe("Stronghold 7 · 16★ of 21 · Next: Tin Hill");
    expect(progressLine(totalsOf(base), "Bramble Keep")).toBe("Stronghold 7 · 16★ of 21 · Next: Bramble Keep");
    expect(lands.totals).toMatchObject({ taken: 7, stars: 16, most: 21, unknown: 1, threeStar: 4, keeps: 2, banners: 1, far: 0 });
    expect(landsOf(campAt(2), at(chapterStartsAt(2))).progress).toBe("Next: Twig Gate");
  });

  it("starts the next stronghold, a replay of one taken, the King, and nothing under fog", () => {
    const lands = landsOf(campAt(3, 2), at(chapterStartsAt(3)));
    expect(raidOf(lands.nodes[2])).toEqual({ kind: "camp", slot: 0 });
    expect(raidOf(lands.nodes[0])).toEqual({ kind: "rematch", slot: 0 });
    expect(raidOf(lands.nodes[7])).toBeNull();
    expect(KING_TARGET).toEqual({ kind: "king", slot: 0 });
  });

  it("knows a stronghold's quirk once it has been scouted", () => {
    const base = markScouted(campAt(3, 2), 2);
    expect(markScouted(base, 2)).toBe(base);
    const lands = landsOf(base, at(base.minutes), { quirkOf: (n) => (n === 2 ? "Thorn hedge" : null) });
    expect(lands.nodes[2]).toMatchObject({ scouted: true, quirk: "Thorn hedge" });
    expect(lands.nodes[1]).toMatchObject({ scouted: false, quirk: null });
  });
});

describe("the Magpie Lands: replays for stars (in place of the rematch)", () => {
  const base = campAt(5, 6, { strongholds: { stars: [3, 1], scouted: [] } });
  const now = at(base.minutes);

  it("can replay any stronghold taken, as it was, its lord too", () => {
    expect(rematchOf(base, 2)).toMatchObject({ kind: "rematch", n: 2, champion: 0 });
    expect(rematchOf(base, 6)).toBeNull();
    expect(raidForecast(base, rematchOf(base, 2)!).sure).toBe(false);
    // The one with most to win: the fewest stars (unknown counts as one), the latest of those.
    expect(replayPick(base)).toBe(5);
    expect(bestStars(base, 0)).toBe(3);
    expect(bestStars(base, 4)).toBe(1);
    expect(replayPick({ ...base, camps: 1 })).toBeNull();
  });

  it("pays for stars past the best only, and a small share of what came down", () => {
    const plan = rematchOf(base, 1)!;
    // Its best is one: a three-star replay pulls in two stars' worth more; a one-star replay only the share.
    expect(replayLoot(base, plan, 3, 1)).toBeCloseTo(plan.loot * (0.2 + 2 / 3));
    expect(replayLoot(base, plan, 1, 1)).toBeCloseTo(plan.loot * 0.2);
    // A stronghold already at three stars: the share, however well it goes.
    expect(replayLoot(base, rematchOf(base, 0)!, 3, 1)).toBeCloseTo(rematchOf(base, 0)!.loot * 0.2);
    // Less than taking it the first time did (its loot, and a quarter more for three stars).
    expect(replayLoot(base, plan, 3, 1)).toBeLessThan(plan.loot * 1.25);
  });

  it("keeps the new best and never moves the ladder", () => {
    const begun = startRaid(base, "rematch", now, false, 1)!;
    expect(begun.raid.plan.n).toBe(1);
    const won = finishRaid(begun.state, begun.raid, { stars: 3, destroyed: 1, hoards: 1 }, DAY);
    expect(won.state.camps).toBe(6);
    expect(won.state.strongholds.stars[1]).toBe(3);
    expect(won.end.loot).toBe(Math.round(begun.raid.plan.loot * (0.2 + 2 / 3)));
    expect(won.state.events[0].text).toMatch(/best yet/);
    // Worse than its best: the best stays.
    const again = startRaid(won.state, "rematch", now, false, 1);
    if (again) expect(finishRaid(again.state, again.raid, { stars: 1, destroyed: 0.5, hoards: 0.5 }, DAY).state.strongholds.stars[1]).toBe(3);
  });

  it("records the stars a stronghold is first taken with", () => {
    const begun = startRaid(base, "camp", now)!;
    const taken = finishRaid(begun.state, begun.raid, { stars: 2, destroyed: 0.8, hoards: 1 }, DAY);
    expect(taken.state.camps).toBe(7);
    expect(taken.state.strongholds.stars[6]).toBe(2);
    const lost = finishRaid(begun.state, begun.raid, { stars: 0, destroyed: 0.3, hoards: 0 }, DAY);
    expect(lost.state.strongholds).toEqual(base.strongholds);
  });
});
