import { describe, expect, it } from "vitest";
import {
  CHAPTERS_MOST,
  CHAPTER_HOURS,
  CHAPTER_OF,
  GOALS,
  NEW_WORKS,
  VOLUME_HOURS,
  WELCOME_CHEST,
  barLine,
  burrowOfChapter,
  chapterBrings,
  chapterNews,
  chapterOf,
  chapterProgress,
  chapterStartsAt,
  chestOf,
  goalNow,
  goalsOf,
  hoursWords,
  opened,
  seeChapter,
  type Unlock
} from "./chapters";
import { WORKS } from "./guards";
import { DARK_WOOD, WORK_CHAPTER } from "./front";
import {
  fronted,
  ACORNS_KEPT_MOST,
  BUILDINGS,
  NEWS_KEPT,
  RAIDS_IN_HAND,
  RAID_EVERY,
  advanceList,
  askedRaids,
  blocked,
  build,
  campWaits,
  chapterFor,
  decorOpen,
  gather,
  keptForm,
  meadowOpen,
  newBase,
  oakReady,
  placeWall,
  plotOpen,
  postOpen,
  prowlersCome,
  purseLeft,
  putBack,
  raidBoard,
  raidForecast,
  raidSummary,
  raidsAsked,
  raidsReady,
  readBase,
  rematchOf,
  seeNews,
  seenOff,
  sendRaid,
  settle,
  startRaid,
  finishRaid,
  sufferRaids,
  workBlocked,
  woodAt,
  woodOf,
  does,
  spotBlocked,
  wallBlocked,
  placeDecor,
  DECOR_LAND,
  LAND,
  WALL_LAND,
  type BaseState,
  type Now
} from "./rules";
import { TIPS } from "./tips";

const DAY = "2026-10-21";
const at = (minutes: number, day = DAY): Now => ({ minutes, day, lit: false });
const H = 60;

/** A camp as a 1.5.9 build kept it: no word of chapters in it at all. */
const keptBy159 = (camp: Partial<BaseState>, levels: Partial<BaseState["levels"]>): Record<string, unknown> => {
  const base = { ...newBase(0, "2026-09-01"), ...camp, levels: { ...newBase(0, DAY).levels, ...levels } } as Record<string, unknown>;
  for (const field of ["minutes", "legacy", "chapterSeen", "chapterPaid", "goals", "news", "downed"]) delete base[field];
  base.stats = { gathered: 900, raids: 3, stars: 6, nights: 0, wagers: 0 };
  return JSON.parse(JSON.stringify(base));
};
/** What a 1.5.9 build does to a camp it reads and saves again: cuts the acorns to 1400 and drops what it does not know. */
const through159 = (saved: Record<string, unknown>, spend = 0): Record<string, unknown> => {
  const known = { ...saved, acorns: Math.min(1400, Number(saved.acorns)) - spend } as Record<string, unknown>;
  for (const field of ["bank", "minutes", "legacy", "chapterSeen", "chapterPaid", "goals", "news", "downed"]) delete known[field];
  return JSON.parse(JSON.stringify(known));
};

describe("the chapters", () => {
  it("are reached by hours read: ten, then a volume every fifteen hours with no end", () => {
    // The first ends after a quarter of an hour: the welcome's "read 15 minutes and the scouts arrive".
    expect(CHAPTER_HOURS).toEqual([0, 0.25, 3, 6, 10, 15, 21, 28, 36, 45]);
    expect(chapterStartsAt(2)).toBe(15);
    expect([0, 14, 15, 179, 180, 359, 360, 599, 600].map(chapterOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5]);
    expect(chapterProgress(null, 5)).toMatchObject({ chapter: 1, toGo: 10 });
    expect(hoursWords(chapterProgress(null, 0).toGo)).toBe("15 m");
    expect(hoursWords(0.4)).toBe("1 m");
    expect(chapterOf(45 * H - 1)).toBe(9);
    expect(chapterOf(45 * H)).toBe(10);
    expect(chapterOf((45 + VOLUME_HOURS) * H - 1)).toBe(10);
    expect(chapterOf((45 + VOLUME_HOURS) * H)).toBe(11);
    expect(chapterOf(1000 * H)).toBe(10 + Math.floor(955 / 15));
    for (let chapter = 1; chapter <= 20; chapter++) {
      expect(chapterOf(chapterStartsAt(chapter))).toBe(chapter);
      expect(chapterOf(chapterStartsAt(chapter) - 1)).toBe(chapter - 1 || 1);
    }
    expect(chapterOf(-5)).toBe(1);
    expect(chapterOf(Number.NaN)).toBe(1);
  });

  it("raise the burrow, and every building's top, with them: 1, 2 at 3, 3 at 5, 4 at 7, 5 at 9", () => {
    expect(Array.from({ length: 12 }, (_, at) => burrowOfChapter(at + 1))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5]);
  });

  it("each bring one new thing, as the review's table has it, and a chest", () => {
    const opens = (chapter: number) => chapterBrings(chapter).things;
    expect(opens(2)).toEqual(["hut", "raids"]);
    expect(opens(3)).toEqual(expect.arrayContaining(["lookout", "prowlers"]));
    expect(opens(4)).toEqual(["fence", "arrange"]);
    expect(opens(5)).toEqual(["yard0", "decor"]);
    expect(opens(6)).toEqual(["guards"]);
    expect(opens(7)).toEqual(["meadow", "animals"]);
    expect(opens(8)).toEqual(["works"]);
    expect(opens(9)).toEqual(["yard1"]);
    expect(opens(10)).toEqual(expect.arrayContaining(["king", "banners"]));
    expect(opens(11)).toEqual(["volumes"]);
    expect(chapterBrings(12).title).toBe("Volume 2");
    for (const [thing, chapter] of Object.entries(CHAPTER_OF)) expect(chapterBrings(chapter).things, thing).toContain(thing as Unlock);
    expect(chestOf(1)).toBe(0);
    for (let chapter = 2; chapter <= 14; chapter++) expect(chestOf(chapter)).toBeGreaterThan(0);
    expect(chapterBrings(5)).toMatchObject({ title: "Chapter 5: The Yard", level: 3 });
    expect(chapterBrings(6).level).toBeNull();
  });

  it("show how far the reading has the camp, and what the next brings", () => {
    const progress = chapterProgress(null, 6 * H + 20);
    expect(progress).toMatchObject({ chapter: 4, from: 360, next: 600, toGo: 220 });
    expect(progress.fraction).toBeCloseTo(20 / 240);
    expect(progress.brings.things).toEqual(["yard0", "decor"]);
    expect(hoursWords(progress.toGo)).toBe("3 h 40 m");
    expect(hoursWords(45)).toBe("45 m");
    expect(hoursWords(15)).toBe("15 m");
    expect(hoursWords(120)).toBe("2 h");
    // The camp's own count wins when it knows of more.
    expect(chapterProgress({ minutes: 700 }, 10).chapter).toBe(5);
    expect(chapterProgress(null, 50 * H).volume).toBeNull();
    expect(chapterProgress(null, 61 * H).volume).toBe(1);
  });
});

describe("a camp begun on chapters", () => {
  /** A reader's camp, at so many hours read in all. */
  const read = (camp: BaseState, minutes: number) => advanceList(settle(camp, at(minutes)), DAY);

  it("opens each thing with its chapter and not before, whatever acorns it has", () => {
    const fresh = { ...newBase(0, DAY), acorns: 1_000_000 };
    for (let chapter = 1; chapter <= 11; chapter++) {
      const camp = { ...read(fresh, chapterStartsAt(chapter)), acorns: 1_000_000 };
      for (const [thing, from] of Object.entries(CHAPTER_OF)) expect(opened(camp, undefined, thing as Unlock), `${thing} at chapter ${chapter}`).toBe(chapter >= from);
      expect(camp.levels.burrow, `the burrow at ${chapter}`).toBe(burrowOfChapter(chapter));
      // What the rules let be built agrees.
      expect(blocked(camp, "hut") === "chapter", `the hut at ${chapter}`).toBe(chapter < 2);
      expect(blocked(camp, "tower") === "chapter", `the lookout at ${chapter}`).toBe(chapter < 3);
      expect(blocked(camp, "fence") === "chapter", `the fence at ${chapter}`).toBe(chapter < 4);
      expect(plotOpen(camp, "yard0")).toBe(chapter >= 5);
      expect(decorOpen(camp)).toBe(chapter >= 5);
      expect(postOpen({ ...camp, levels: { ...camp.levels, tower: 2 } }, 0)).toBe(chapter >= 6);
      expect(meadowOpen(camp)).toBe(chapter >= 7);
      for (const kind of NEW_WORKS) expect(workBlocked(camp, kind) === null, `${WORKS[kind].name} at ${chapter}`).toBe(chapter >= WORK_CHAPTER[kind]);
      expect(plotOpen(camp, "yard1")).toBe(chapter >= 9);
      expect(prowlersCome(camp)).toBe(chapter >= 3);
      // The burrow is never bought.
      expect(blocked(camp, "burrow")).toBe(camp.levels.burrow >= 5 ? "top" : "chapter");
      // Nothing is built past the burrow.
      for (const site of BUILDINGS.filter((name) => name !== "burrow")) {
        const high = { ...camp, levels: { ...camp.levels, [site]: camp.levels.burrow } };
        if (camp.levels.burrow < 5) expect(blocked(high, site), `${site} past the burrow at ${chapter}`).toBe("chapter");
      }
    }
  });

  it("has seven kinds of construct since 1.5.11, each from its chapter, and says which chapter a building waits for", () => {
    const camp = { ...read(newBase(0, DAY), chapterStartsAt(9)), acorns: 100_000 };
    WORKS.forEach((_, kind) => expect(workBlocked(camp, kind) === null, WORKS[kind].name).toBe(NEW_WORKS.includes(kind)));
    expect(NEW_WORKS).toHaveLength(7);
    // The five that were folded into others, or are no more, are not to be had.
    expect(WORKS.filter((work) => work.retired)).toHaveLength(5);
    const two = read(newBase(0, DAY), chapterStartsAt(2));
    expect(chapterFor(two, "tower")).toBe(3);
    expect(chapterFor(two, "fence")).toBe(4);
    expect(chapterFor(two, "yard1")).toBe(9);
    expect(chapterFor({ ...two, levels: { ...two.levels, oak: 1 } }, "oak")).toBe(3);
  });

  it("goes through its first ninety days at half an hour a day: chests paid once each, goals as they are done", () => {
    let camp: BaseState = newBase(0, DAY);
    const chests: number[] = [];
    let seen = 1;
    for (let day = 1; day <= 120; day++) {
      const before = camp.acorns;
      camp = read(camp, day * 30);
      const news = chapterNews(camp);
      if (news) {
        expect(news.kind).toBe("up");
        chests.push(news.chapter);
        expect(news.chapter).toBeGreaterThan(seen);
        seen = news.chapter;
        camp = seeChapter(camp);
        expect(chapterNews(camp)).toBeNull();
      }
      expect(camp.acorns).toBeGreaterThanOrEqual(before);
    }
    // Half an hour a day is 60 hours in 120 days: chapter 11, the first volume.
    expect(chapterOf(camp.minutes)).toBe(11);
    expect(chests).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(camp.chapterPaid).toBe(11);
    expect(camp.levels.burrow).toBe(5);
    // The events say each chapter.
    expect(camp.events.some((event) => event.text.startsWith("Volume 1"))).toBe(true);
  });

  it("pays a goal once, when it is done, and only for this chapter's goals and before", () => {
    const two = read({ ...newBase(0, DAY), acorns: 200 }, chapterStartsAt(2));
    expect(goalNow(two)?.goal.id).toBe("oak");
    const tapped = advanceList(gather(two, chapterStartsAt(2) + 30), DAY);
    expect(tapped.goals).toContain("oak");
    const larder = advanceList(build(tapped, "store", 90, undefined, undefined, DAY), DAY);
    expect(larder.goals).toEqual(expect.arrayContaining(["oak", "larder"]));
    expect(larder.acorns).toBe(tapped.acorns - 28 + 10);
    // Done again, it pays nothing more.
    expect(advanceList(larder, DAY)).toBe(larder);
    // The basket (none given yet) is the next, then the hut.
    const hut = advanceList(build({ ...larder, welcome: { ...larder.welcome, basketOpened: true } }, "hut", 90, undefined, undefined, DAY), DAY);
    expect(hut.goals).toEqual(expect.arrayContaining(["basket", "hut"]));
    expect(goalNow(hut)?.goal.id).toBe("raid");
    expect(goalsOf(hut, 2).map((entry) => [entry.goal.id, entry.ticked])).toEqual([["hut", true], ["raid", false]]);
    // A goal of a later chapter done early waits for its chapter, and is paid then.
    const fenced = { ...hut, camps: 3 };
    expect(advanceList(fenced, DAY).goals).not.toContain("strongholds3");
    expect(read(fenced, chapterStartsAt(4)).goals).toContain("strongholds3");
  });

  it("has a bar that always says something: the next goal, or the reading to the next chapter", () => {
    const fresh = read(newBase(0, DAY), 10);
    expect(barLine(fresh).text).toBe("Tap the oak to take in its acorns");
    // With nothing left to do in chapter 1, the bar is the welcome's promise.
    expect(barLine({ ...read(newBase(0, DAY), 0), goals: GOALS.map((goal) => goal.id) }).text).toBe("Read 15 m: chapter 2 brings the scouts' hut");
    const done = { ...read(newBase(0, DAY), chapterStartsAt(3) + 40), goals: GOALS.map((goal) => goal.id) };
    expect(barLine(done).text).toBe("Read 2 h 20 m: chapter 4 brings the fence");
    const far = { ...read(newBase(0, DAY), chapterStartsAt(10)), goals: GOALS.map((goal) => goal.id) };
    expect(barLine(far).text).toBe("Read 15 h: volume 1 brings a standing stone");
  });

  it("counts a prowler seen off, for its goal", () => {
    const three = read(newBase(0, DAY), chapterStartsAt(3));
    expect(goalsOf(three, 3).find((entry) => entry.goal.id === "prowler")?.done).toBe(false);
    const seen = advanceList(seenOff(three), DAY);
    expect(seen.stats.seenOff).toBe(1);
    expect(seen.goals).toContain("prowler");
  });
});

describe("a camp brought onto chapters", () => {
  /** An old camp read by 1.5.10 and brought up to so many minutes read. */
  const brought = (camp: Partial<BaseState>, levels: Partial<BaseState["levels"]>, minutes: number) => settle(readBase(keptBy159(camp, levels))!, at(minutes));

  for (const [burrow, minutes] of [
    [1, 30],
    [3, 5 * H],
    [5, 20 * H],
    [5, 60 * H]
  ] as const) {
    it(`keeps everything a level-${burrow} camp had opened, at ${hoursWords(minutes)} read, and is paid one chest and no back pay`, () => {
      const levels = { burrow, oak: burrow, store: burrow, fence: burrow > 1 ? 1 : 0, tower: 1, hut: 1 };
      const kept = keptBy159({ acorns: 300, oakFrom: minutes, camps: 4, yard: [{ kind: burrow >= 2 ? "hive" : null, level: burrow >= 2 ? 1 : 0 }, { kind: null, level: 0 }] }, levels);
      const read = readBase(kept)!;
      expect(read.legacy).toEqual({ burrow });
      expect(read.chapterSeen).toBe(-1);
      const now = settle(read, at(minutes));
      // Nothing lowered.
      for (const site of BUILDINGS) expect(now.levels[site], site).toBeGreaterThanOrEqual(levels[site]);
      expect(now.levels.burrow).toBe(Math.max(burrow, burrowOfChapter(chapterOf(minutes))));
      // Nothing that was open closes.
      const oldGates: Array<[Unlock, number]> = [["prowlers", 2], ["fence", 2], ["decor", 2], ["yard0", 2], ["guards", 3], ["meadow", 3], ["yard1", 3]];
      for (const [thing, from] of oldGates) if (burrow >= from) expect(opened(now, minutes, thing), thing).toBe(true);
      WORKS.forEach((work, kind) => {
        if (burrow >= work.burrow && !work.retired) expect(workBlocked({ ...now, acorns: 10_000 }, kind), work.name).toBeNull();
      });
      // One chest, and the card that says so; none for the chapters already reached.
      expect(now.acorns).toBe(300 + WELCOME_CHEST);
      expect(now.chapterPaid).toBe(chapterOf(minutes));
      expect(chapterNews(now)).toMatchObject({ kind: "welcome", chapter: chapterOf(minutes), chest: WELCOME_CHEST });
      expect(campWaits(now, at(minutes))).toBe(true);
      const seen = seeChapter(now);
      expect(chapterNews(seen)).toBeNull();
      // Its goals already done are ticked, and none of them paid.
      expect(now.goals).toEqual(expect.arrayContaining(["oak", "larder", "hut", "lookout", "raid", "strongholds3"]));
      expect(advanceList(now, DAY).acorns).toBe(now.acorns);
      // Brought on once: read and settled again, nothing more is paid.
      const again = settle(readBase(JSON.parse(JSON.stringify(keptForm(seen))))!, at(minutes));
      expect(again.acorns).toBe(seen.acorns);
      expect(again.legacy).toEqual({ burrow });
    });
  }

  it("is not paid at once for the reading the old rules let go: the oak, the scouts' rest and the runs as they were", () => {
    // Away for a month: 30 hours read since the oak was last gathered.
    const now = brought({ acorns: 0, oakFrom: 0, raidFrom: 0, purseFrom: 0 }, { burrow: 2, oak: 1, store: 1, hut: 1 }, 30 * H);
    expect(oakReady(now, 30 * H)).toBe(50);
    expect(raidsReady(now, 30 * H)).toBe(3);
    expect(purseLeft(now, 30 * H)).toBe(5);
    // From here on, nothing expires.
    expect(oakReady(now, 40 * H)).toBe(50 + 10 * 6 * 8);
    expect(raidsReady(now, 40 * H)).toBe(RAIDS_IN_HAND);
  });

  it("keeps the old list as it was, and the paws given, and gives no more", () => {
    const now = brought({ quest: 7, welcome: { given: true, paws: 2, basketOpened: true, firstReadParcel: null, tutorial: { step: 0, done: true, skipped: false }, prowlersAfterRead: false, windfall: 0, from: 0 } }, { burrow: 2, store: 1 }, 100);
    expect(now.welcome.paws).toBe(2);
    expect(now.quest).toBeGreaterThanOrEqual(7);
  });
});

describe("acorns past 1400", () => {
  it("are kept: in the larder as the camp has them, and saved with no more than 1400 in acorns and the rest in the bank", () => {
    const rich = { ...newBase(0, DAY), acorns: 5321 };
    const saved = JSON.parse(JSON.stringify(keptForm(rich)));
    expect(saved.acorns).toBe(ACORNS_KEPT_MOST);
    expect(saved.bank).toBe(5321 - ACORNS_KEPT_MOST);
    expect(readBase(saved)!.acorns).toBe(5321);
    expect(readBase(saved)).toEqual(readBase(JSON.parse(JSON.stringify(keptForm(readBase(saved)!)))));
    // A poor camp has an empty bank.
    expect(JSON.parse(JSON.stringify(keptForm({ ...rich, acorns: 90 })))).toMatchObject({ acorns: 90, bank: 0 });
    // The old reading of a camp knows nothing of a bank: a camp from 1.5.9 reads as it was.
    expect(readBase(keptBy159({ acorns: 1400 }, {}))!.acorns).toBe(1400);
  });

  it("are not lost when a 1.5.9 build reads the camp, spends some, and saves it again", () => {
    const camp = { ...settle(newBase(0, DAY), at(20 * H)), acorns: 3000, goals: ["oak", "larder", "hut"] };
    const saved = JSON.parse(JSON.stringify(keptForm(camp)));
    // 1.5.9 cuts nothing: what it reads is 1400 at most.
    expect(saved.acorns).toBeLessThanOrEqual(1400);
    const back = readBase(through159(saved, 100))!;
    expect(back.acorns).toBe(3000 - 100);
    // And it was not brought onto chapters a second time, nor paid again.
    expect(back.legacy).toBeNull();
    expect(back.chapterSeen).toBe(camp.chapterSeen);
    expect(back.chapterPaid).toBe(camp.chapterPaid);
    expect(back.goals).toEqual(expect.arrayContaining(["oak", "larder", "hut"]));
    const settled = settle(back, at(20 * H));
    expect(settled.acorns).toBe(back.acorns);
  });

  it("are never capped by anything the camp does", () => {
    let camp = { ...newBase(0, DAY), acorns: 1400, oakFrom: 0 };
    camp = gather(camp, 10_000);
    expect(camp.acorns).toBe(1400 + 8000);
  });
});

describe("raids, 1.5.10", () => {
  const ready = { ...settle(newBase(0, DAY), at(3 * H)), acorns: 0, levels: { ...newBase(0, DAY).levels, burrow: 2, hut: 2 }, raidFrom: 0 };

  it("offer a rematch of the last stronghold taken: a sure win, for a little, that moves nothing on", () => {
    expect(rematchOf(ready)).toBeNull();
    const four = { ...ready, camps: 4 };
    const rematch = rematchOf(four)!;
    expect(rematch).toMatchObject({ kind: "rematch", n: 3, cost: 0 });
    expect(raidForecast(four, rematch)).toMatchObject({ stars: 3, canSend: true, sure: true });
    const sent = sendRaid(four, "rematch", at(3 * H))!;
    expect(sent.end).toMatchObject({ won: true, stars: 3 });
    expect(sent.state.camps).toBe(4);
    expect(sent.end.loot).toBeLessThan(rematchOf({ ...four, camps: 5 })!.loot * 3);
    // Even the hardest stronghold, once taken, is a sure thing.
    expect(raidForecast({ ...ready, camps: 30 }, rematchOf({ ...ready, camps: 30 })!).stars).toBe(3);
  });

  it("show a board: the rematch, the next stronghold, and the King from chapter 10, none of them for acorns", () => {
    expect(raidBoard(ready, at(3 * H)).map((card) => card.kind)).toEqual(["camp"]);
    expect(raidBoard({ ...ready, camps: 2 }, at(3 * H)).map((card) => card.kind)).toEqual(["rematch", "camp"]);
    const late = { ...ready, camps: 2, minutes: 45 * H };
    expect(raidBoard(late, at(45 * H)).map((card) => card.kind)).toEqual(["rematch", "camp", "king"]);
    for (const card of raidBoard(late, at(45 * H))) {
      expect(card.plan.cost).toBe(0);
      expect(card.forecast.words.length).toBeGreaterThan(10);
    }
    expect(raidBoard({ ...late, banners: ["2026-10"] }, at(45 * H)).map((card) => card.kind)).toEqual(["rematch", "camp"]);
  });

  it("refuse to send scouts who would lose, and cost only the rest when fought and lost", () => {
    const far = { ...ready, camps: 40 };
    expect(sendRaid(far, "camp", at(3 * H))).toBeNull();
    const begun = startRaid(far, "camp", at(3 * H))!;
    expect(begun.state.acorns).toBe(0);
    expect(raidsReady(begun.state, 3 * H)).toBe(RAIDS_IN_HAND - 1);
    const lost = finishRaid(begun.state, begun.raid, { stars: 0, destroyed: 0, hoards: 0 }, DAY);
    expect(lost.state.acorns).toBe(0);
    expect(raidSummary(lost.end)).toBe("Beaten back. Nothing lost but the scouts' rest.");
  });

  it("say how it went in plain words, a stronghold's name lower case inside the sentence", () => {
    const won = sendRaid({ ...ready, camps: 0 }, "camp", at(3 * H))!;
    expect(raidSummary(won.end)).toMatch(/^You took the Twig Nest: \d+ acorns\./);
    expect(raidSummary({ ...won.end, name: "Bramble Roost" })).toMatch(/^You took Bramble Roost: /);
  });

  it("move the ladder one step at a time, three stars or one", () => {
    let camp = { ...ready, raidFrom: -RAID_EVERY * 10 };
    for (let raid = 0; raid < 3; raid++) camp = sendRaid(camp, "camp", at(3 * H))!.state;
    expect(camp.camps).toBe(3);
  });
});

describe("friends' raids, 1.5.10", () => {
  // A wall of the second level across the trail: five sections, the gate among them.
  const fenced = fronted({ ...newBase(0, DAY), levels: { ...newBase(0, DAY).levels, burrow: 2, fence: 2 }, guards: [1, 1, 0, 1, 0, 0, 0] });

  it("are news for the next look: who, how many stars, the fence that fell, and the day; five at most", () => {
    const raided = sufferRaids(fenced, [{ name: "Maya", stars: 2 }, { name: "Tom", stars: 0 }], 0, DAY, 1000);
    expect(raided.news).toEqual([
      { by: "Tom", stars: 0, down: 0, prize: 8, day: DAY },
      { by: "Maya", stars: 2, down: 2, prize: 0, day: DAY }
    ]);
    expect(raided.walls).toHaveLength(3);
    // The nearest the gate first, the gate itself among them.
    expect(raided.downed.map(([, y]) => y).sort()).toEqual([74, 84]);
    expect(raided.acorns).toBe(fenced.acorns + 8);
    // Nobody is put to sleep.
    expect(raided.tired).toEqual({});
    const many = sufferRaids(fenced, Array.from({ length: 8 }, (_, at) => ({ name: `F${at}`, stars: 1 })), 0, DAY);
    expect(many.news).toHaveLength(NEWS_KEPT);
    expect(many.news[0].by).toBe("F7");
    expect(seeNews(raided).news).toEqual([]);
    const looked = seeNews(raided);
    expect(seeNews(looked)).toBe(looked);
    // Kept with the camp.
    expect(readBase(JSON.parse(JSON.stringify(raided)))!.news).toEqual(raided.news);
  });

  it("are put right in one go: every section of the wall back where it stood", () => {
    const raided = sufferRaids(fenced, [{ name: "Maya", stars: 3 }], 0, DAY);
    expect(raided.walls).toHaveLength(2);
    expect(raided.downed).toHaveLength(3);
    const back = putBack(raided);
    expect([...back.walls].sort()).toEqual([...fenced.walls].sort());
    expect(back.downed).toEqual([]);
    expect(putBack(back)).toBe(back);
    // Kept across a save, and put back then.
    expect(putBack(readBase(JSON.parse(JSON.stringify(raided)))!).walls).toHaveLength(5);
  });

  it("ask once whether friends may raid the camp", () => {
    expect(raidsAsked(fenced)).toBe(false);
    const asked = askedRaids(fenced);
    expect(raidsAsked(asked)).toBe(true);
    expect(askedRaids(asked)).toBe(asked);
    expect(raidsAsked(readBase(JSON.parse(JSON.stringify(keptForm(asked))))!)).toBe(true);
  });
});

describe("the clearing", () => {
  const at5 = (minutes: number, legacy: { burrow: number } | null = null): BaseState => ({ ...newBase(0, DAY), minutes, legacy, levels: { ...newBase(0, DAY).levels, burrow: 5 } });

  it("widens with the burrow, but for the last time only with chapter 10, as the picture draws it", () => {
    expect(woodOf(at5(chapterStartsAt(9)))).toBe(woodAt(4));
    expect(woodOf(at5(chapterStartsAt(10)))).toBe(0);
    // A camp from before chapters that had the whole clearing keeps it.
    expect(woodOf(at5(0, { burrow: 5 }))).toBe(0);
    expect(woodOf({ ...at5(chapterStartsAt(5)), levels: { ...newBase(0, DAY).levels, burrow: 3 } })).toBe(woodAt(3));
  });

  it("is where things can be set down: nothing goes into wood still standing, and nothing already there is moved", () => {
    const nine = { ...at5(chapterStartsAt(9)), acorns: 10_000, levels: { ...newBase(0, DAY).levels, burrow: 5, fence: 5 } };
    const edge = DECOR_LAND.left + 2;
    // Into the wood: refused for a building or a piece of fence, and a decoration lands at the wood's edge.
    expect(spotBlocked(nine, "store", LAND.right - 2, 90)).toBe("edge");
    expect(spotBlocked(nine, "store", LAND.left + 2, 90)).toBe("edge");
    expect(wallBlocked(nine, WALL_LAND.left + 2, 90)).toBe("none");
    expect(placeDecor(nine, 0, edge, 90).decor[0].x).toBe(DECOR_LAND.left + woodAt(4));
    // At chapter 10 the same ground is open on the right; the Dark Wood on the left never clears (1.5.11).
    const ten = { ...nine, minutes: chapterStartsAt(10) };
    expect(spotBlocked(ten, "store", LAND.right - 2, 90)).toBeNull();
    expect(spotBlocked(ten, "store", LAND.left + 2, 90)).toBe("edge");
    expect(placeDecor(ten, 0, edge, 90).decor[0].x).toBe(edge);
    // And the wall stands clear of the trees.
    expect(fronted(ten).front.x).toBeGreaterThanOrEqual(DARK_WOOD + 20);
    // What a camp already has out there stays where it is, through a read and a settle.
    const kept = { ...nine, decor: [{ kind: 0, x: edge, y: 90 }] };
    const back = settle(readBase(JSON.parse(JSON.stringify(keptForm(kept))))!, at(chapterStartsAt(9)));
    expect(back.decor).toEqual(kept.decor);
  });
});

describe("the rules' own words", () => {
  it("say what prowlers do as it is now: small, fixable, once a day", () => {
    const tip = TIPS.find((entry) => entry.id === "prowler")!;
    expect(tip.text).toMatch(/tap it to fix/);
    expect(tip.text).toMatch(/once a day/);
    for (let level = 0; level <= 5; level++) {
      for (const site of ["hut", "fence", "tower", "store", "oak"] as const) {
        expect(does(site, level), `${site} ${level}`).not.toMatch(/takes a few acorns|holds \d|% stronger|\d+ far/);
      }
    }
    expect(does("store", 2)).toBe("Keeps 90 acorns safe from prowlers");
    expect(does("tower", 3)).toBe("Throws further and harder; brighter on a day your reading goal is met");
  });
});

describe("nothing expires", () => {
  it("a reader away for weeks finds every acorn, parcel and raid's rest waiting", () => {
    const camp = { ...settle({ ...newBase(0, DAY), acorns: 0 }, at(0)), levels: { ...newBase(0, DAY).levels, oak: 2, hut: 1 } };
    // Three weeks at an hour a day, the Hollow not opened once.
    let away = camp;
    for (let day = 1; day <= 21; day++) away = { ...away, parcels: away.parcels + 2 };
    expect(oakReady(away, 21 * H)).toBe(21 * 6 * 13);
    expect(raidsReady(away, 21 * H)).toBe(RAIDS_IN_HAND);
    expect(readBase(JSON.parse(JSON.stringify(away)))!.parcels).toBe(42);
    expect(CHAPTERS_MOST).toBe(10);
  });
});
