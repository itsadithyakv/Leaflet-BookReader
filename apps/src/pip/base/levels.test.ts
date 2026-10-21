import { describe, expect, it } from "vitest";
import { WORKS } from "./guards";
import { WORK_CHAPTER } from "./front";
import { CHAPTER_OF, NEW_WORKS, chapterStartsAt, opened } from "./chapters";
import {
  MAX_LEVEL,
  fronted,
  frontChapter,
  PLOT_FROM,
  blocked,
  build,
  burrowFor,
  campOpens,
  chapterFor,
  decorOpen,
  magpies,
  meadowOpen,
  moveSite,
  newBase,
  plotOpen,
  postOpen,
  settle,
  spotBlocked,
  standing,
  wallBlocked,
  workBlocked,
  type BaseState
} from "./rules";
import { beforeChapters } from "./testing";

const DAY = "2026-10-12";
/** A camp from before chapters at a level: what its burrow opened then, it keeps. */
const camp = (burrow: number, more: Partial<BaseState> = {}): BaseState => {
  const base = newBase(0, DAY);
  return beforeChapters({ ...base, acorns: 5000, levels: { ...base.levels, burrow, store: 5 }, ...more });
};
/** A camp begun on chapters, brought up to the start of a chapter. */
const onChapter = (chapter: number, more: Partial<BaseState> = {}): BaseState => {
  const read = chapterStartsAt(chapter);
  const base = settle({ ...newBase(0, DAY), acorns: 5000, ...more }, { minutes: read, day: DAY, lit: false });
  return { ...base, acorns: 5000 };
};

describe("a camp from before chapters", () => {
  it("keeps the plots its level had brought: none at level 1, one at 2, both at 3", () => {
    expect(standing(camp(1))).not.toContain("yard0");
    expect(standing(camp(1))).not.toContain("yard1");
    expect(standing(camp(2))).toContain("yard0");
    expect(standing(camp(2))).not.toContain("yard1");
    expect(standing(camp(3))).toEqual(expect.arrayContaining(["yard0", "yard1"]));
  });

  it("will not have a plot built on before it is there, and says which chapter it waits for", () => {
    expect(blocked(camp(1), "yard0", "hive")).toBe("chapter");
    expect(burrowFor(camp(1), "yard0")).toBe(3);
    expect(chapterFor(camp(1), "yard0")).toBe(5);
    expect(blocked(camp(2), "yard0", "hive")).toBeNull();
    expect(blocked(camp(2), "yard1", "well")).toBe("chapter");
    expect(chapterFor(camp(2), "yard1")).toBe(9);
    expect(blocked(camp(3), "yard1", "well")).toBeNull();
    expect(build(camp(2), "yard1", 0, "well")).toEqual(camp(2));
  });

  it("leaves standing a plot that was built on under the old rule", () => {
    const old = camp(2, { yard: [{ kind: "hive", level: 1 }, { kind: "well", level: 1 }] });
    expect(plotOpen(old, "yard1")).toBe(true);
    expect(standing(old)).toContain("yard1");
  });

  it("does not let a plot that is not there get in the way", () => {
    const base = camp(1);
    const [x, y] = base.spots.yard0;
    expect(spotBlocked(base, "hut", x, y)).toBeNull();
    expect(spotBlocked(camp(2), "hut", x, y)).toBe("building");
    // Nor the wall's line (1.5.11): an empty plot is ground, and the wall goes where it would without it.
    const walled = { ...base, levels: { ...base.levels, fence: 1 } };
    expect(wallBlocked(walled, x, y)).toBe("none");
    expect(fronted({ ...walled, legacy: { burrow: 2 } }).front.x).toBe(fronted(walled).front.x);
  });

  it("keeps what its level opened, whatever the chapter: decorations, the meadow, guardians and constructs", () => {
    expect([decorOpen(camp(1)), decorOpen(camp(2))]).toEqual([false, true]);
    expect([meadowOpen(camp(2)), meadowOpen(camp(3))]).toEqual([false, true]);
    expect(opened(camp(2), 0, "guards")).toBe(false);
    expect(opened(camp(3), 0, "guards")).toBe(true);
    // Each construct by its own level, as it was (the six of chapter 8 are not opened early by a low level).
    for (let level = 1; level <= MAX_LEVEL; level++) {
      // (The five folded into others in 1.5.11 are had by nobody now.)
      WORKS.forEach((work, kind) => expect(workBlocked(camp(level), kind) === null, `${work.name} at ${level}`).toBe(!work.retired && (level >= work.burrow || frontChapter(camp(level)) >= WORK_CHAPTER[kind])));
    }
    // And the magpies come to a camp of level 2 as they did.
    expect(magpies(camp(1))).toBe(0);
    expect(magpies(camp(2))).toBeGreaterThan(0);
  });
});

describe("a camp begun on chapters", () => {
  it("is given its plots with the burrow its chapter raises: the first at level 3 (chapter 5), the second at 5 (chapter 9)", () => {
    expect(PLOT_FROM).toEqual({ yard0: 3, yard1: 5 });
    expect(standing(onChapter(4))).not.toContain("yard0");
    expect(standing(onChapter(5))).toContain("yard0");
    expect(onChapter(5).levels.burrow).toBe(3);
    expect(standing(onChapter(8))).not.toContain("yard1");
    expect(standing(onChapter(9))).toContain("yard1");
  });

  it("seats a new plot on free ground when something was put where it would have been", () => {
    let base = onChapter(2);
    const [x, y] = base.spots.yard0;
    base = moveSite(base, "hut", x, y);
    expect(base.spots.hut).toEqual([x, y]);
    // Chapter 5: the burrow goes up to 3, and the plot comes.
    base = settle(base, { minutes: chapterStartsAt(5), day: DAY, lit: false });
    expect(base.levels.burrow).toBe(3);
    expect(base.spots.hut).toEqual([x, y]);
    expect(spotBlocked(base, "yard0", base.spots.yard0[0], base.spots.yard0[1])).toBeNull();
    expect(base.events.some((event) => event.text.startsWith("Chapter 5: The Yard."))).toBe(true);
  });

  it("opens, with each level of the burrow, what its two chapters bring, and nothing a level early", () => {
    for (let level = 2; level <= MAX_LEVEL; level += 1) {
      // The level comes with the first of its two chapters; what the second brings comes with it.
      const first = 2 * level - 1;
      const before = onChapter(first - 1);
      const now = onChapter(first + 1);
      const opens = campOpens(level);
      expect(opens.length, `level ${level} opens something`).toBeGreaterThan(0);
      for (const entry of opens) {
        const said = `${entry.name} at level ${level}`;
        if (entry.kind === "plot") {
          const site = entry.name === "A plot in the yard" ? "yard0" : "yard1";
          expect([plotOpen(before, site), plotOpen(now, site)], said).toEqual([false, true]);
        } else if (entry.kind === "decor") {
          expect([decorOpen(before), decorOpen(now)], said).toEqual([false, true]);
        } else if (entry.kind === "meadow") {
          expect([meadowOpen(before), meadowOpen(now)], said).toEqual([false, true]);
        } else if (entry.kind === "guards") {
          expect([opened(before, undefined, "guards"), opened(now, undefined, "guards")], said).toEqual([false, true]);
        } else if (entry.kind === "work") {
          expect(workBlocked(before, entry.which!), said).toBe("chapter");
          expect(workBlocked(now, entry.which!), said).toBeNull();
        } else if (entry.kind === "fence") {
          expect(blocked(before, "fence"), said).toBe("chapter");
          expect(blocked(now, "fence"), said).toBeNull();
        } else if (entry.kind === "postcard") {
          expect(level, said).toBe(2);
        }
      }
    }
    const all = [2, 3, 4, 5].flatMap((level) => campOpens(level));
    expect(all.filter((entry) => entry.kind === "work").map((entry) => entry.which)).toEqual([...NEW_WORKS]);
    // Who comes down the trail (1.5.11): a kind a chapter from the fourth.
    expect(all.filter((entry) => entry.kind === "foe").map((entry) => entry.name)).toEqual(["Prowlers", "Runners", "Fliers", "Brutes", "Diggers", "Bombers"]);
    expect(all.filter((entry) => entry.kind === "plot")).toHaveLength(2);
    expect(campOpens(1)).toEqual([]);
  });

  it("has guardians' posts only from chapter 6", () => {
    const five = onChapter(5, { levels: { burrow: 1, oak: 2, store: 2, fence: 0, tower: 2, hut: 2 } });
    expect(postOpen(five, 0)).toBe(false);
    const six = settle(five, { minutes: chapterStartsAt(CHAPTER_OF.guards), day: DAY, lit: false });
    expect(postOpen(six, 0)).toBe(true);
  });
});
