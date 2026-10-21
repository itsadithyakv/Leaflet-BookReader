import { describe, expect, it } from "vitest";
import {
  FIRST_READ_MINUTES,
  FIRST_READ_PARCEL,
  PARCELS_MOST,
  TROPHY_MINUTES,
  WELCOMED,
  WELCOME_BASKET,
  WELCOME_WINDFALL,
  advanceList,
  build,
  campNews,
  campWaits,
  gather,
  newBase,
  oakReady,
  priceOf,
  openParcel,
  prowlersCome,
  raise,
  readBase,
  settle,
  trophyBudget,
  trophyWaits,
  type BaseState,
  type Now,
  type Site
} from "./rules";
import { tipNow } from "./tips";
import { GOALS, chestOf } from "./chapters";
import { finishTutorial, giveWelcome, openWelcomeBasket, pawFinish, setTutorialStep, tutorialOn } from "./welcome";

// Autumn, and a week's streak: the oak gives more of what is read in both, and the gift must not.
const DAY = "2026-10-16";
const READ = 300;
const nowAt = (minutes = READ): Now => ({ minutes, day: DAY, lit: false, streak: 7, today: 0, goalMet: false });

/** As the store does it: brought up to now, the change, and the list ticked. */
const act = (state: BaseState, change: (base: BaseState, now: Now) => BaseState, minutes = READ) => {
  const now = nowAt(minutes);
  return advanceList(change(settle(state, now), now), now.day);
};
/** The chapter goals' rewards paid between two camps (since 1.5.10 the old list pays nothing). */
const goalsPaid = (before: BaseState, after: BaseState) => GOALS.filter((goal) => after.goals.includes(goal.id) && !before.goals.includes(goal.id)).reduce((sum, goal) => sum + goal.reward, 0);

/** A reader with five hours of reading behind them and no camp yet: the camp is made, opened, and welcomed. */
const welcomed = () => act(settle(newBase(READ, DAY), nowAt()), (base, now) => giveWelcome(base, now.minutes));

/** Pip's guided first session, step by step, as the store's actions do it; each camp along the way. */
const walk = () => {
  const start = welcomed();
  const shaken = act(start, (base, now) => gather(base, now.minutes, now.streak, now.day));
  // (Each build stands as soon as it is paid for since 1.5.8: the paws that used to finish these two have nothing to do.)
  const larder = act(shaken, (base, now) => build(base, "store", now.minutes, undefined, undefined, now.day));
  const basket = act(larder, (base, now) => openWelcomeBasket(base, now.day));
  // (The burrow is not built since 1.5.10: five hours read is chapter 3, and the burrow is at level 2 already.)
  return { start, shaken, larder, basket, burrow: basket };
};

describe("Pip's welcome basket: the walk through", () => {
  it("holds the walk's figures at 1.5.10: the chapters' chests, 20 shaken, the larder, the basket, and the goals' acorns", () => {
    const { start, shaken, larder, basket } = walk();
    // Five hours read before the camp was made: chapter 3, with the chests of chapters 2 and 3, and the burrow at 2.
    expect(start.levels.burrow).toBe(2);
    expect(start.acorns).toBe(20 + chestOf(2) + chestOf(3));
    expect(oakReady(start, READ)).toBe(WELCOME_WINDFALL);

    expect(shaken.acorns - start.acorns - goalsPaid(start, shaken)).toBe(WELCOME_WINDFALL);
    expect(goalsPaid(start, shaken)).toBe(10);
    expect(oakReady(shaken, READ)).toBe(0);

    expect(larder.levels.store).toBe(1);
    expect(goalsPaid(shaken, larder)).toBe(10);
    expect(priceOf(shaken, "store", 1)).toBe(28);

    expect(basket.acorns - larder.acorns - goalsPaid(larder, basket)).toBe(WELCOME_BASKET);
    // No paw was given (1.5.10), and none was wanted.
    expect(basket.welcome.paws).toBe(0);
  });

  it("loses nothing anywhere on the way", () => {
    const { start, basket } = walk();
    // Everything given or paid came in: the gift, the goals, less what was spent on the larder.
    expect(basket.acorns).toBe(start.acorns + WELCOME_WINDFALL + WELCOME_BASKET + goalsPaid(start, basket) - 28);
  });

  it("opens the basket whenever it is opened: there is always room for it", () => {
    const { shaken } = walk();
    expect(openWelcomeBasket(shaken, DAY).acorns).toBe(shaken.acorns + WELCOME_BASKET);
    expect(campWaits(shaken, nowAt())).toBe(true);
  });

  it("opens the basket once, and gives the welcome once", () => {
    const { start, basket } = walk();
    expect(giveWelcome(start, READ + 500)).toBe(start);
    expect(openWelcomeBasket(basket, DAY)).toBe(basket);
    expect(giveWelcome(basket, READ)).toBe(basket);
  });

  it("has paws with nothing to do: a paw only finishes what was going up, and nothing goes up any more", () => {
    const { burrow } = walk();
    const hut = act(burrow, (base, now) => pawFinish(base, "hut", now.minutes));
    expect(hut).toBe(advanceList(settle(burrow, nowAt()), DAY));
    // Paid for, it stands: no reading wanted.
    const built = act({ ...burrow, acorns: 100 }, (base, now) => build(base, "hut", now.minutes, undefined, undefined, now.day));
    expect(built.levels.hut).toBe(1);
    expect(built.jobs).toEqual([]);
  });

  it("spends no paw where nothing can go up", () => {
    const start = welcomed();
    // Twenty acorns: the burrow's second level is 100, and more than the camp can hold.
    expect(pawFinish(start, "burrow", READ)).toBe(start);
    expect(pawFinish(start, "yard0" as Site, READ)).toBe(start);
  });
});

describe("nothing in the welcome is reading", () => {
  it("moves no clock, no trophy's reading, and no minute", () => {
    const { start, burrow } = walk();
    for (const key of ["oakFrom", "raidFrom", "purseFrom", "nightAt", "claimed"] as const) expect(burrow[key]).toBe(start[key]);
    expect(trophyBudget(burrow, READ)).toBe(trophyBudget(start, READ));
    expect(trophyWaits(burrow, READ)).toBe(trophyWaits(start, READ));
  });

  it("leaves the jobs where reading began them: a paw says the job wants no more, and no more than that", () => {
    const start = welcomed();
    const rich = { ...start, acorns: 60 };
    const begun = build(rich, "store", READ);
    const pawed = pawFinish(begun, "store", READ);
    expect(pawed.jobs[0].from).toBe(begun.jobs[0].from);
    expect(pawed.jobs[0].needs).toBe(0);
  });

  it("raises no trophy: a book finished at once still wants its hour and a half", () => {
    // A camp that has read nothing since its trophies were reckoned: the gift does not stand in for reading.
    const { burrow } = walk();
    const claimedAll = { ...burrow, claimed: READ };
    expect(raise(claimedAll, "book-1", "A Book", DAY, 0, READ)).toBe(claimedAll);
    expect(raise(claimedAll, "book-1", "A Book", DAY, 0, READ + TROPHY_MINUTES).raised).toHaveLength(1);
  });

  it("shakes acorns onto the oak, not minutes: the oak's own fall is what it was", () => {
    const start = welcomed();
    const plain = { ...start, welcome: { ...start.welcome, windfall: 0 } };
    expect(oakReady(start, READ + 10) - oakReady(plain, READ + 10)).toBe(WELCOME_WINDFALL);
    // Gathered with the oak's own, the oak's clock is set by the reading alone.
    expect(gather(start, READ + 10, 0, DAY).oakFrom).toBe(gather(plain, READ + 10, 0, DAY).oakFrom);
  });
});

describe("the first reading's parcel", () => {
  const ended = () => act(walk().burrow, (base, now) => finishTutorial(base, false, now.minutes));

  it("comes once, after five minutes read since the welcome, with forty acorns in it", () => {
    const camp = ended();
    expect(camp.welcome.firstReadParcel).toBe("waiting");
    const early = settle(camp, nowAt(READ + FIRST_READ_MINUTES - 1));
    expect(early.parcels).toBe(camp.parcels);
    const came = settle(camp, nowAt(READ + FIRST_READ_MINUTES));
    expect(came.welcome.firstReadParcel).toBe("sent");
    expect(came.parcels).toBe(camp.parcels + 1);
    expect(campWaits(came, nowAt(READ + FIRST_READ_MINUTES))).toBe(true);
    expect(campNews(came, READ + FIRST_READ_MINUTES)).toMatch(/a parcel is waiting/i);
    const opened = openParcel(came);
    expect(opened.acorns - came.acorns).toBe(FIRST_READ_PARCEL);
    expect(opened.welcome.firstReadParcel).toBe("opened");
    // Never again, however much is read.
    const later = settle(opened, nowAt(READ + 600));
    expect(later.welcome.firstReadParcel).toBe("opened");
  });

  it("waits while the path is full of parcels, and comes when there is room", () => {
    const camp = { ...ended(), parcels: PARCELS_MOST };
    expect(settle(camp, nowAt(READ + 30)).welcome.firstReadParcel).toBe("waiting");
  });

  it("is opened whole, however many acorns the camp has", () => {
    const came = settle(ended(), nowAt(READ + FIRST_READ_MINUTES));
    const full = { ...came, acorns: 1400 };
    expect(openParcel(full).acorns).toBe(1400 + FIRST_READ_PARCEL);
  });

  it("never comes to a camp from before the welcome", () => {
    const old = readBase(JSON.parse(JSON.stringify({ ...newBase(0, DAY), welcome: undefined })))!;
    expect(settle(old, nowAt(500)).parcels).toBe(0);
  });
});

describe("prowlers wait for the reading", () => {
  it("hold off from a welcomed camp at level 2 until the reader has read after the session", () => {
    const { burrow } = walk();
    expect(burrow.levels.burrow).toBe(2);
    expect(prowlersCome(burrow)).toBe(false);
    const ended = act(burrow, (base, now) => finishTutorial(base, false, now.minutes));
    expect(prowlersCome(settle(ended, nowAt(READ)))).toBe(false);
    expect(prowlersCome(settle(ended, nowAt(READ + 1)))).toBe(true);
  });

  it("come to a camp from before the welcome as they always did", () => {
    // (From before chapters too: its level 2 had brought them, and it keeps them.)
    const old = readBase({ ...JSON.parse(JSON.stringify(newBase(0, DAY))), welcome: undefined, legacy: undefined, levels: { burrow: 2, oak: 1, store: 1, fence: 0, tower: 0, hut: 0 } })!;
    expect(prowlersCome(old)).toBe(true);
  });
});

describe("old camps and kept camps", () => {
  it("reads a camp from before 1.5.5 as welcomed: no gift, no session, no paws", () => {
    const kept = JSON.parse(JSON.stringify({ ...newBase(0, DAY), acorns: 300, levels: { burrow: 3, oak: 2, store: 2, fence: 1, tower: 1, hut: 1 } }));
    delete kept.welcome;
    const old = readBase(kept)!;
    expect(old.welcome).toEqual(WELCOMED);
    expect(giveWelcome(old, 999)).toBe(old);
    expect(oakReady(old, 0)).toBe(0);
    expect(openWelcomeBasket(old, DAY)).toBe(old);
    expect(pawFinish({ ...old, acorns: 1000 }, "hut", 0).welcome.paws).toBe(0);
    expect(tutorialOn(old)).toBe(false);
  });

  it("keeps the welcome as it was through a save, and holds what it reads to what it can be", () => {
    const { larder } = walk();
    expect(readBase(JSON.parse(JSON.stringify(larder)))).toEqual(larder);
    const odd = readBase({ ...JSON.parse(JSON.stringify(larder)), welcome: { given: true, paws: 99, windfall: 5000, firstReadParcel: "lots", tutorial: { step: -4 } } })!;
    expect(odd.welcome.paws).toBe(2);
    expect(odd.welcome.windfall).toBe(WELCOME_WINDFALL);
    expect(odd.welcome.firstReadParcel).toBeNull();
    expect(odd.welcome.tutorial).toEqual({ step: 0, done: false, skipped: false });
  });

  it("starts a new camp with nothing given", () => {
    const fresh = newBase(READ, DAY);
    expect(fresh.welcome.given).toBe(false);
    expect(oakReady(fresh, READ)).toBe(0);
    expect(campWaits(fresh, nowAt())).toBe(false);
  });
});

describe("the guided session", () => {
  it("keeps its step, and keeps nothing once it is over", () => {
    const start = welcomed();
    const on = setTutorialStep(start, 3);
    expect(on.welcome.tutorial.step).toBe(3);
    const done = finishTutorial(on, false, READ);
    expect(done.welcome.tutorial).toEqual({ step: 3, done: true, skipped: false });
    expect(setTutorialStep(done, 5)).toBe(done);
    expect(finishTutorial(done, true, READ)).toBe(done);
  });

  it("skipped, still leaves the basket, once", () => {
    const fresh = settle(newBase(READ, DAY), nowAt());
    const skipped = finishTutorial(fresh, true, READ);
    expect(skipped.welcome.given).toBe(true);
    expect(skipped.welcome.basketOpened).toBe(false);
    expect(skipped.welcome.tutorial.skipped).toBe(true);
    expect(finishTutorial(skipped, true, READ)).toBe(skipped);
    expect(giveWelcome(skipped, READ)).toBe(skipped);
  });

  it("stands in for the oak, build and parcel tips, and none is said while it is on", () => {
    const start = welcomed();
    expect(tipNow(start)).toBeNull();
    const done = finishTutorial(start, false, READ);
    expect(done.taught).toEqual(expect.arrayContaining(["oak", "build", "parcel"]));
    // Skipped, the tips teach instead.
    expect(finishTutorial(start, true, READ).taught).not.toContain("oak");
  });
});
