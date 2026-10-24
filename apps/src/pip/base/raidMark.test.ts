import { describe, expect, it } from "vitest";
import { MARKED_MOST, RAIDS_MARK, bestOf, cleanStrongholds, isRaidsMark, raidsMark, readRaidsMark, readStrongholds, withScouted, withStars, type Strongholds } from "./raidMark";
import { keptForm, newBase, readBase, type BaseState } from "./rules";

const DAY = "2026-10-24";
const camp = (strongholds: Strongholds, camps = 6): BaseState => ({ ...newBase(600, DAY), camps, strongholds });

describe("the strongholds' record (the Magpie Lands)", () => {
  it("is short, and reads back as it was written", () => {
    const record: Strongholds = { stars: [3, 2, 0, 1, 3, 2], scouted: [1, 2, 7] };
    const lines = raidsMark(record);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith(RAIDS_MARK)).toBe(true);
    expect(lines[0].length).toBeLessThanOrEqual(80);
    expect(readRaidsMark(["oak", ...lines])).toEqual(record);
    expect(raidsMark({ stars: [], scouted: [] })).toEqual([]);
    expect(readRaidsMark(["oak"])).toBeNull();
  });

  it("runs over more lines for a long ladder, each within a line of taught, and keeps 608 strongholds", () => {
    const stars = Array.from({ length: MARKED_MOST }, (_, n) => 1 + (n % 3));
    const lines = raidsMark({ stars, scouted: [0, 300, MARKED_MOST - 1] });
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(80);
      expect(isRaidsMark(line)).toBe(true);
    }
    expect(readRaidsMark(lines)).toEqual({ stars, scouted: [0, 300, MARKED_MOST - 1] });
  });

  it("keeps a best: a raid with fewer stars changes nothing, and scouted stays scouted", () => {
    let record = withStars({ stars: [], scouted: [] }, 4, 2);
    expect(record.stars).toEqual([0, 0, 0, 0, 2]);
    expect(withStars(record, 4, 1)).toBe(record);
    record = withStars(record, 4, 3);
    expect(record.stars[4]).toBe(3);
    expect(withScouted(withScouted(record, 2), 2).scouted).toEqual([2]);
    expect(cleanStrongholds({ stars: [9, -1, "x", 2, 0, 0], scouted: [3, 3, -2, 1.5, 1] })).toEqual({ stars: [3, 0, 0, 2], scouted: [1, 3] });
  });

  it("goes round a save and back", () => {
    const base = camp({ stars: [3, 1, 2], scouted: [3] });
    const back = readBase(JSON.parse(JSON.stringify(keptForm(base))))!;
    expect(back.strongholds).toEqual(base.strongholds);
    // The mark is not left in the tips' list once read.
    expect(back.taught.some(isRaidsMark)).toBe(false);
    expect(keptForm(back).taught.filter(isRaidsMark)).toHaveLength(1);
  });

  it("survives a save by an older build, which drops the field and keeps taught as it is", () => {
    const base = camp({ stars: [2, 3, 1, 0, 3], scouted: [5] });
    const saved = JSON.parse(JSON.stringify(keptForm(base)));
    delete saved.strongholds;
    expect(readBase(saved)!.strongholds).toEqual(base.strongholds);
  });

  it("reads a camp from before it as strongholds taken with their stars unknown", () => {
    const old = JSON.parse(JSON.stringify(keptForm(camp({ stars: [], scouted: [] }, 7))));
    delete old.strongholds;
    old.taught = old.taught.filter((entry: string) => !isRaidsMark(entry));
    const back = readBase(old)!;
    expect(back.camps).toBe(7);
    expect(back.strongholds).toEqual({ stars: [], scouted: [] });
  });

  it("keeps the best of both where a camp's field and its mark differ (a merge between devices)", () => {
    // One device replayed stronghold 1 to three stars; the other scouted 4 and took 0 with three. The newer save is
    // whole, and the older one's mark is folded into its own (merge_camp): the best of each is kept.
    const mine: Strongholds = { stars: [1, 3, 2], scouted: [] };
    const theirs: Strongholds = { stars: [3, 1, 2], scouted: [4] };
    expect(bestOf(mine, theirs)).toEqual({ stars: [3, 3, 2], scouted: [4] });
    expect(bestOf(theirs, mine)).toEqual(bestOf(mine, theirs));
    const newer = JSON.parse(JSON.stringify(keptForm(camp(mine))));
    newer.taught = [...newer.taught.filter((entry: string) => !isRaidsMark(entry)), ...raidsMark(bestOf(mine, theirs))];
    expect(readBase(newer)!.strongholds).toEqual({ stars: [3, 3, 2], scouted: [4] });
    expect(readStrongholds(mine, raidsMark(theirs))).toEqual(bestOf(mine, theirs));
  });
});
