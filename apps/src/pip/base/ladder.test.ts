import { describe, expect, it } from "vitest";
import { chipLine, groupAt, ladderGroups, ladderOf, levelBrings, stepWhy, tutorialRunning } from "./ladder";
import { MAX_LEVEL, QUESTS, WELCOMED, advanceList, newBase, type BaseState, type BuildingId } from "./rules";
import { beforeChapters } from "./testing";

const DAY = "2026-10-16";
/** A camp past its welcome (the basket opened), unless a test says otherwise. */
const camp = (change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}): BaseState => {
  const fresh = newBase(1000, DAY);
  return beforeChapters({ ...fresh, welcome: { ...fresh.welcome, given: true, basketOpened: true }, ...change, levels: { ...fresh.levels, ...levels } });
};
const quest = (id: string) => QUESTS.find((entry) => entry.id === id)!;
const at = (id: string) => QUESTS.findIndex((entry) => entry.id === id);

describe("the ladder's groups", () => {
  it("cuts the list at each raising of the burrow, which is the last of its group", () => {
    const groups = ladderGroups();
    expect(groups.map((group) => group.to)).toEqual([2, 3, 4, 5, null]);
    for (const group of groups.slice(0, 4)) expect(QUESTS[group.end - 1].raise).toBe(group.to);
    // Every step is in one group, in order.
    expect(groups[0].from).toBe(0);
    for (let index = 1; index < groups.length; index++) expect(groups[index].from).toBe(groups[index - 1].end);
    expect(groups[groups.length - 1].end).toBe(QUESTS.length);
    // Three to five steps a group: something to do, never a chore list.
    for (const group of groups) expect(group.end - group.from).toBeGreaterThanOrEqual(3);
    for (const group of groups) expect(group.end - group.from).toBeLessThanOrEqual(5);
  });

  it("puts the first camp's steps under level 2: the oak, the larder, the basket, the burrow", () => {
    expect(QUESTS.slice(ladderGroups()[0].from, ladderGroups()[0].end).map((entry) => entry.short)).toEqual(["Tap the oak", "Larder", "Pip's basket", "Burrow 2"]);
    expect(groupAt(at("lookout"))?.to).toBe(3);
    expect(groupAt(QUESTS.length)).toBeNull();
  });

  it("asks nothing of a group that its level has not brought", () => {
    // A step of the group that raises the burrow to n is done at level n - 1: what it needs has come by then.
    const needs: Record<string, number> = { fence: 2, raid: 1, construct: 2, yard: 2, guardian: 3, animal: 3 };
    for (const group of ladderGroups()) {
      const level = group.to === null ? MAX_LEVEL : group.to - 1;
      for (const entry of QUESTS.slice(group.from, group.end)) expect(needs[entry.id] ?? 1, entry.id).toBeLessThanOrEqual(level);
    }
  });
});

describe("where the camp is on it", () => {
  it("a new camp: burrow 1, none of four done, the oak next for 10", () => {
    // Welcomed: the basket waits by the door.
    const fresh = newBase(1000, DAY);
    const ladder = ladderOf({ ...fresh, welcome: { ...fresh.welcome, given: true } }, 1000);
    expect(ladder.level).toBe(1);
    expect(ladder.total).toBe(4);
    expect(ladder.done).toBe(0);
    expect(ladder.next?.quest.id).toBe("oak");
    expect(ladder.next?.reward).toBe(10);
    expect(ladder.steps.map((step) => step.state)).toEqual(["now", "later", "later", "later"]);
    expect(chipLine(ladder)).toBe("Pip's list 0/4 · next: Tap the oak");
  });

  it("a camp at level 2 with the hut built: 1 of 5, the lookout next for 15", () => {
    const state = camp({ quest: at("lookout") }, { burrow: 2, store: 1, hut: 1 });
    const ladder = ladderOf(state, 1000);
    expect(ladder.group?.to).toBe(3);
    expect(ladder.done).toBe(1);
    expect(ladder.total).toBe(5);
    expect(chipLine(ladder)).toBe("Pip's list 1/5 · next: Lookout");
    expect(ladder.next?.reward).toBe(15);
    // The last step raises the burrow.
    expect(ladder.steps[ladder.steps.length - 1].quest.raise).toBe(3);
  });

  it("counts a step ahead that is already done, and never says the larder is full (1.5.10: it has no brim)", () => {
    const ahead = ladderOf(camp({ quest: at("hut") }, { burrow: 2, store: 1, tower: 1 }), 1000);
    expect(ahead.steps.find((step) => step.quest.id === "lookout")?.state).toBe("done");
    expect(ahead.done).toBe(1);
    const full = ladderOf(camp({ quest: at("hut"), acorns: 150 }, { burrow: 2, store: 1, hut: 1 }), 1000);
    expect(full.full).toBe(false);
  });

  it("is done at the end of the list", () => {
    const ladder = ladderOf(camp({ quest: QUESTS.length }, { burrow: 5 }), 1000);
    expect(ladder.next).toBeNull();
    expect(ladder.steps).toEqual([]);
    expect(chipLine(ladder)).toBe("Pip's list: all done");
  });
});

describe("why a step waits", () => {
  it("raising the burrow waits for its chapter: it is never bought (1.5.10)", () => {
    expect(stepWhy(camp({ acorns: 50_000 }), quest("burrow2"), 1000)).toBe("Comes with chapter 3");
  });

  it("says how many acorns are missing (of the whole price, work and all), and what is going up", () => {
    // The larder: 25 of materials and 3 of work.
    expect(stepWhy(camp({ acorns: 20 }), quest("larder"), 1000)).toBe("8 more acorns");
    expect(stepWhy(camp({ acorns: 30 }), quest("larder"), 1000)).toBeNull();
    // (A job still waiting on reading is only ever one kept from before 1.5.8, until the camp is next brought up to now.)
    const building = camp({ acorns: 0, jobs: [{ site: "store", to: 1, from: 1000, needs: 5 }] });
    expect(stepWhy(building, quest("larder"), 1002)).toBe("Going up: 3 more minutes of reading");
  });

  it("the fence waits for the burrow, and strongholds are counted", () => {
    expect(stepWhy(camp({ acorns: 50 }), quest("fence"), 1000)).toBe("Comes with chapter 4");
    expect(stepWhy(camp({ camps: 2 }, { burrow: 3 }), quest("strongholds5"), 1000)).toBe("2 of 5 taken");
  });

  it("says nothing of a step that is done", () => {
    expect(stepWhy(camp({}, { store: 1 }), quest("larder"), 1000)).toBeNull();
  });
});

describe("what a level brings", () => {
  const JARGON = /tanglefoot|caltrop|archer|prowler|rootgnaw|fizzwick|construct|ward|magpie/i;

  it("is three named things at most, in plain words", () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      const brings = levelBrings(level);
      expect(brings.length, `level ${level}`).toBeGreaterThan(0);
      expect(brings.length).toBeLessThanOrEqual(3);
      for (const entry of brings) {
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.name).not.toMatch(JARGON);
        expect(entry.says).not.toMatch(JARGON);
      }
    }
  });

  it("level 2 is a bigger clearing, a fence and the prowlers; level 3 brings the guardians and the yard", () => {
    expect(levelBrings(2).map((entry) => entry.name)).toEqual(["A bigger clearing", "A fence", "Visitors from the wood"]);
    expect(levelBrings(3).map((entry) => entry.name)).toEqual(["A bigger clearing", "Guardians", "A plot in the yard"]);
    expect(levelBrings(1)).toEqual([]);
    expect(levelBrings(MAX_LEVEL + 1)).toEqual([]);
  });

  it("the list shows what the level it is working towards brings", () => {
    expect(ladderOf(camp(), 1000).brings.map((entry) => entry.name)).toEqual(levelBrings(2).map((entry) => entry.name));
  });
});

describe("Pip's guided first session", () => {
  it("is running only while the camp says so", () => {
    // A new camp has it to come; a camp from before it, none.
    expect(tutorialRunning(camp())).toBe(true);
    expect(tutorialRunning({ ...camp(), welcome: WELCOMED })).toBe(false);
    expect(tutorialRunning(null)).toBe(false);
    expect(tutorialRunning({ ...camp(), welcome: { tutorial: { step: 2, done: false } } } as BaseState)).toBe(true);
    expect(tutorialRunning({ ...camp(), welcome: { tutorial: { step: 8, done: true } } } as BaseState)).toBe(false);
  });
});

describe("the chip after the oak is tapped into a full larder (the emulator, 2026-10-19)", () => {
  it("names the next thing, Build a larder, not the oak again", () => {
    // No larder (60 at most), the oak tapped to the brim: 60 of 60, the first step done.
    const tapped = { ...camp({ acorns: 60, stats: { gathered: 40, raids: 0, stars: 0, nights: 0, wagers: 0 } }), quest: 0 };
    const moved = advanceList(tapped, "2026-10-19");
    expect(moved.quest).toBe(1);
    // The old list pays nothing since 1.5.10 (the chapter's goals do).
    expect(moved.acorns).toBe(60);
    const ladder = ladderOf(moved, 1000);
    expect(ladder.full).toBe(false);
    expect(chipLine(ladder)).toMatch(/· next: Larder$/);
  });
});
