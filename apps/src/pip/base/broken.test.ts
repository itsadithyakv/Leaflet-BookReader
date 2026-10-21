import { describe, expect, it } from "vitest";
import {
  fronted,
  slideWall,
  wallRange,
  KNOCKS_A_DAY,
  THEFTS_A_DAY,
  GATE_FROM,
  PARCELS_MOST,
  STRETCH_MINUTES,
  gateOf,
  openParcel,
  parcelGives,

  storyRead,
  wallAt,
  TROPHY_GIVES,
  TROPHY_MINUTES,
  adopt,
  isRaised,
  raise,
  settle,
  trophyBudget,
  trophyWaits,
  AUTUMN_OAK,
  BROKEN_OAK,
  HARM_MOST,
  HUT_BEDS,
  PROWLER_TAKES,
  REST_MS,
  SEASONS,
  bedsOf,
  chooseHero,
  gather,
  hasBed,
  lodgers,
  oakDrops,
  oakReady,
  residents,
  robSite,
  seasonOf,
  campStructures,
  fencePieces,
  fixCost,
  fixSite,
  footOf,
  harmSite,
  hasFire,
  hides,
  isAsleep,
  isBroken,
  newBase,
  restMs,
  spotBlocked,
  woundFighter,
  type BaseState
} from "./rules";
import { beforeChapters } from "./testing";

const DAY = "2026-10-13";
const AT = 1_800_000_000_000;
const mine = (more: Partial<BaseState> = {}): BaseState => beforeChapters({ ...newBase(0, DAY), acorns: 500, levels: { burrow: 3, oak: 3, store: 3, fence: 2, tower: 2, hut: 3 }, ...more });
// A knock a day: prowlers only do so much in one (`KNOCKS_A_DAY`).
const knocked = (state: BaseState, site: "tower" | "store" | "oak" | "hut", times: number) =>
  Array.from({ length: times }).reduce<BaseState>((now, _, index) => harmSite(now, site, `2026-11-${String(index + 1).padStart(2, "0")}`), state);
const lookout = (state: BaseState) => campStructures(state, false).find((entry) => entry.look?.name === "tower")!;

describe("a building the prowlers have broken", () => {
  it("is one knocked about as far as it goes, and not before", () => {
    const base = mine();
    expect(isBroken(knocked(base, "tower", HARM_MOST - 1), "tower")).toBe(false);
    expect(isBroken(knocked(base, "tower", HARM_MOST), "tower")).toBe(true);
    // And no further: there is nothing more to do to it.
    expect(knocked(base, "tower", HARM_MOST + 3).harm.tower).toBe(HARM_MOST);
  });

  it("throws at nobody until it is put right", () => {
    const base = mine();
    expect(lookout(base).range).toBeGreaterThan(0);
    // Knocked about short of broken, it throws as far and as hard as ever (the tenth a knock it used to lose went on 2026-10-15).
    expect(lookout(knocked(base, "tower", HARM_MOST - 1)).range).toBe(lookout(base).range);
    expect(lookout(knocked(base, "tower", HARM_MOST - 1)).hit).toBeCloseTo(lookout(base).hit, 6);
    const broken = knocked(base, "tower", HARM_MOST);
    expect([lookout(broken).range, lookout(broken).hit]).toEqual([0, 0]);
    const mended = fixSite(broken, "tower");
    expect(mended.acorns).toBe(broken.acorns - fixCost(broken, "tower"));
    expect(lookout(mended).range).toBe(lookout(base).range);
  });

  it("hides nothing, when it is the larder", () => {
    const base = mine();
    expect(hides(base)).toBeGreaterThan(0);
    // As much as ever until it is broken, and then nothing.
    expect(hides(knocked(base, "store", HARM_MOST - 1))).toBe(hides(base));
    expect(hides(knocked(base, "store", HARM_MOST))).toBe(0);
  });
});

describe("the campfire", () => {
  it("is where the worn out get their strength back in half the time", () => {
    const cold = mine({ guards: [2, 0, 0, 1, 0, 0, 0] });
    const warm = { ...cold, decor: [{ kind: 10, x: 120, y: 104 }] };
    expect([hasFire(cold), hasFire(warm)]).toEqual([false, true]);
    expect([restMs(cold), restMs(warm)]).toEqual([REST_MS, REST_MS / 2]);
    const out = (state: BaseState) => [0, 1, 2].reduce((now, knock) => woundFighter(now, 0, AT + knock, DAY), state);
    expect(isAsleep(out(cold), 0, AT + REST_MS / 2 + 10)).toBe(true);
    expect(isAsleep(out(warm), 0, AT + REST_MS / 2 - 10)).toBe(true);
    expect(isAsleep(out(warm), 0, AT + REST_MS / 2 + 10)).toBe(false);
  });
});

describe("room for a wall", () => {
  it("is a wall across the trail, longer with every level of the fence, until it spans the whole approach", () => {
    expect(fencePieces(mine({ levels: { burrow: 5, oak: 1, store: 1, fence: 5, tower: 1, hut: 1 } }))).toBe(7);
    expect(fencePieces(mine({ levels: { burrow: 2, oak: 1, store: 1, fence: 0, tower: 1, hut: 1 } }))).toBe(0);
    const lengths = [1, 2, 3, 4, 5].map((fence) => fronted(mine({ levels: { burrow: 5, oak: 1, store: 1, fence, tower: 1, hut: 1 } })).walls.length);
    expect(lengths).toEqual([3, 5, 6, 7, 7]);
  });

  it("is the ground a building takes: nothing is built within its foot and another's", () => {
    const base = mine();
    const [x, y] = base.spots.store;
    // Just inside the two feet together, it may not stand; just outside, it may (where nothing else is in the way).
    const need = footOf("tower") + footOf("store");
    expect(spotBlocked(base, "tower", x + need - 2, y)).toBe("building");
    expect(footOf("burrow")).toBeGreaterThan(footOf("tower"));
    expect(footOf("tower")).toBeLessThan(5);
  });
});

describe("the oak and the larder, which are what a prowler is after", () => {
  it("drops half as much, when the oak is broken, and never nothing", () => {
    const base = mine();
    // Knocked about, as many as ever; broken, half.
    expect(oakDrops(knocked(base, "oak", HARM_MOST - 1))).toBeCloseTo(oakDrops(base), 6);
    expect(oakDrops(knocked(base, "oak", HARM_MOST))).toBe(oakDrops(base) * BROKEN_OAK);
    // Mended, it is as it was.
    expect(oakDrops(fixSite(knocked(base, "oak", 2), "oak"))).toBe(oakDrops(base));
    expect(BROKEN_OAK).toBeGreaterThan(0);
  });

  it("loses a few acorns to one who is not stopped, and never what the larder hides", () => {
    const base = mine({ acorns: 500 });
    const robbed = robSite(base, "store", 0, DAY);
    expect(robbed.taken).toBe(PROWLER_TAKES(3));
    expect(robbed.state.acorns).toBe(500 - robbed.taken);
    expect(robbed.state.events[0].text).toBe(`A prowler made off with ${robbed.taken} acorns from the larder.`);
    // What is hidden is not found.
    const poor = mine({ acorns: hides(base) + 3 });
    expect(robSite(poor, "store", 0, DAY).taken).toBe(3);
    expect(robSite(mine({ acorns: hides(base) }), "store", 0, DAY).taken).toBe(0);
    // And it is a few however much there is.
    expect(PROWLER_TAKES(5)).toBeLessThanOrEqual(8);
  });

  it("is only so much in a day, however many get through and however long the camp is watched", () => {
    let base = mine({ acorns: 500 });
    // A whole afternoon of them at everything.
    for (let prowler = 0; prowler < 40; prowler++) {
      for (const site of ["store", "oak", "tower", "hut", "burrow"] as const) base = robSite(harmSite(base, site, DAY), site, 600, DAY).state;
    }
    const knocks = (["store", "oak", "tower", "hut", "burrow"] as const).reduce((sum, site) => sum + (base.harm[site] ?? 0), 0);
    expect(knocks).toBe(KNOCKS_A_DAY);
    expect(500 - base.acorns).toBeLessThanOrEqual(THEFTS_A_DAY * PROWLER_TAKES(3));
    // All of it put right costs less than a parcel or two bring.
    const mend = (["store", "oak", "tower", "hut", "burrow"] as const).reduce((sum, site) => sum + fixCost(base, site), 0);
    expect(mend).toBeLessThanOrEqual(KNOCKS_A_DAY * (2 + 3));
    // The next day they can do as much again, and no more.
    let next = base;
    for (let prowler = 0; prowler < 40; prowler++) next = harmSite(next, "tower", "2026-12-01");
    expect((next.harm.tower ?? 0) - (base.harm.tower ?? 0)).toBe(KNOCKS_A_DAY);
  });

  it("loses only what was hanging ready on the oak", () => {
    const base = mine();
    // Nothing ready, nothing to shake out.
    expect(robSite(base, "oak", base.oakFrom, DAY)).toEqual({ state: base, taken: 0 });
    const later = base.oakFrom + 600;
    const ready = oakReady(base, later);
    expect(ready).toBeGreaterThan(PROWLER_TAKES(3));
    const robbed = robSite(base, "oak", later, DAY);
    expect(robbed.taken).toBe(PROWLER_TAKES(3));
    // Those and no more, though the tree had stood full a long while.
    expect(oakReady(robbed.state, later)).toBeLessThanOrEqual(ready - robbed.taken + 1);
    expect(oakReady(robbed.state, later)).toBeGreaterThanOrEqual(ready - robbed.taken - 1);
    expect(robbed.state.acorns).toBe(base.acorns);
    // Nothing is taken from anywhere else.
    expect(robSite(base, "tower", later, DAY).taken).toBe(0);
  });
});

describe("beds in the hut", () => {
  const read = (hut: number, hero: number | null = null): BaseState => {
    const base = mine({ levels: { burrow: 3, oak: 3, store: 3, fence: 2, tower: 2, hut } });
    // Books enough for every hero to have come.
    const full = { ...base, shelf: base.shelf.map(() => 40), raised: Array.from({ length: 400 }, (_, id) => String(id)) };
    return hero === null ? full : chooseHero(full, hero);
  };

  it("are more for every level of it, and one by the fire before there is a hut", () => {
    expect(HUT_BEDS).toEqual([...HUT_BEDS].sort((a, b) => a - b));
    expect(HUT_BEDS.map((_, hut) => bedsOf(read(hut)))).toEqual([...HUT_BEDS]);
    expect(HUT_BEDS[0]).toBe(1);
  });

  it("hold as many heroes as there are beds, and no hero is lost for the want of one", () => {
    const camp = read(2);
    const here = residents(camp).length;
    expect(here).toBeGreaterThan(bedsOf(camp));
    expect(lodgers(camp)).toHaveLength(bedsOf(camp));
    // Everybody who came is still here to be chosen.
    expect(residents(camp)).toHaveLength(here);
    expect(lodgers(read(5))).toHaveLength(Math.min(here, HUT_BEDS[5]));
  });

  it("always have one for whoever leads the raids", () => {
    const last = residents(read(1))[residents(read(1)).length - 1].id;
    expect(hasBed(read(1), last)).toBe(false);
    expect(hasBed(read(1, last), last)).toBe(true);
    expect(lodgers(read(1, last))).toHaveLength(bedsOf(read(1)));
  });

  it("are down to the one while the hut is broken", () => {
    expect(bedsOf(knocked(read(4), "hut", HARM_MOST))).toBe(1);
    expect(bedsOf(knocked(read(4), "hut", HARM_MOST - 1))).toBe(HUT_BEDS[4]);
  });
});

describe("the seasons", () => {
  it("follow the calendar, and each does one thing", () => {
    expect(["2026-07-01", "2026-10-13", "2026-01-12", "2026-04-02"].map(seasonOf)).toEqual([0, 1, 2, 3]);
    expect(SEASONS.map((season) => season.name)).toEqual(["Summer", "Autumn", "Winter", "Spring"]);
  });

  it("make the oak heavier in autumn", () => {
    const base = mine({ acorns: 0 });
    const later = base.oakFrom + 600;
    const plain = gather(base, later, 0, null).acorns;
    // A second gathering of the day, so that the morning's dew is not counted.
    const summer = gather({ ...base, dewDay: "2026-07-01" }, later, 0, "2026-07-01").acorns;
    const autumn = gather({ ...base, dewDay: "2026-10-13" }, later, 0, "2026-10-13").acorns;
    expect(summer).toBe(plain);
    expect(autumn).toBe(plain + Math.round(plain * AUTUMN_OAK));
  });

  it("make mending cheaper in spring", () => {
    const hurt = knocked(mine(), "tower", 3);
    expect(fixCost(hurt, "tower", "2026-04-02")).toBe(Math.ceil(fixCost(hurt, "tower") * 0.75));
    expect(fixCost(hurt, "tower", "2026-10-13")).toBe(fixCost(hurt, "tower"));
    expect(fixSite(hurt, "tower", "2026-04-02").acorns).toBe(hurt.acorns - fixCost(hurt, "tower", "2026-04-02"));
  });

  it("make the fire warmer in winter", () => {
    const warm = mine({ decor: [{ kind: 10, x: 120, y: 104 }] });
    expect(restMs(warm, "2026-01-12")).toBe(REST_MS / 3);
    expect(restMs(warm, "2026-10-13")).toBe(REST_MS / 2);
    // With no fire, winter is no help.
    expect(restMs(mine(), "2026-01-12")).toBe(REST_MS);
  });
});

describe("a trophy, which is what brings a hero", () => {
  const now = (minutes: number) => ({ minutes, day: DAY, lit: false });
  const fresh = (): BaseState => ({ ...newBase(0, DAY), adopted: true });

  it("is not had for marking a book as finished: it stands on reading", () => {
    const base = fresh();
    // Twenty books ticked off, and not a minute read.
    let camp = base;
    for (let book = 0; book < 20; book++) camp = raise(camp, `book-${book}`, `Book ${book}`, DAY, 1, 0);
    expect(camp).toBe(base);
    expect(residents(camp)).toEqual(residents(base));
    expect(trophyWaits(base, 0)).toBe(TROPHY_MINUTES);
    expect(trophyWaits(base, 30)).toBe(TROPHY_MINUTES - 30);
  });

  it("is raised when the reading is there, and that reading stands behind no other", () => {
    const base = fresh();
    const one = raise(base, "a", "A", DAY, 1, TROPHY_MINUTES);
    expect(isRaised(one, "a")).toBe(true);
    expect(one.acorns).toBe(base.acorns + TROPHY_GIVES);
    expect(trophyBudget(one, TROPHY_MINUTES)).toBe(0);
    // A second book ticked off at the same moment waits for its own hour and a half.
    expect(raise(one, "b", "B", DAY, 1, TROPHY_MINUTES)).toBe(one);
    expect(trophyWaits(one, TROPHY_MINUTES + 40)).toBe(TROPHY_MINUTES - 40);
    expect(isRaised(raise(one, "b", "B", DAY, 1, TROPHY_MINUTES * 2), "b")).toBe(true);
    // A long book read in one go stands behind as many as it was long.
    let many = base;
    for (let book = 0; book < 10; book++) many = raise(many, `book-${book}`, `Book ${book}`, DAY, 1, TROPHY_MINUTES * 4);
    expect(many.raised).toHaveLength(4);
  });

  it("is given to the books finished before there was a camp only as far as has been read", () => {
    const books = Array.from({ length: 30 }, (_, book) => ({ id: `book-${book}`, kind: 1 }));
    const unread = adopt(newBase(0, DAY), books, 0);
    expect([unread.raised.length, unread.adopted]).toEqual([0, true]);
    const read = adopt(newBase(0, DAY), books, TROPHY_MINUTES * 6 + 20);
    expect(read.raised).toHaveLength(6);
    expect(trophyBudget(read, TROPHY_MINUTES * 6 + 20)).toBe(20);
    // And the rest are raised as the reading comes.
    expect(isRaised(raise(read, "book-29", "Later", DAY, 1, TROPHY_MINUTES * 7), "book-29")).toBe(true);
  });

  it("takes nothing back from a camp kept before this, and gives it no windfall either", () => {
    // A camp from before: ten trophies, and a hundred hours read.
    const before = { ...fresh(), claimed: -1, raised: Array.from({ length: 10 }, (_, book) => `k${book}`) };
    const after = settle(before, now(6000));
    expect(after.raised).toHaveLength(10);
    // Room for the book they are in the middle of, and no more than that.
    expect(trophyBudget(after, 6000)).toBe(TROPHY_MINUTES);
    let camp = after;
    for (let book = 0; book < 5; book++) camp = raise(camp, `new-${book}`, "New", DAY, 1, 6000);
    expect(camp.raised).toHaveLength(11);
    // A library restored from an older day has no more behind its trophies than has been read.
    expect(settle({ ...fresh(), claimed: 900 }, now(300)).claimed).toBe(300);
  });
});

describe("the story being read", () => {
  const camp = () => mine({ acorns: 0 });

  it("brings a parcel for a chapter finished, with the reading to show for it", () => {
    // The first the camp hears of a book only says where the reading is.
    const begun = storyRead(camp(), "book", 3, 100, DAY, "A Book");
    expect([begun.parcels, begun.story?.mark]).toEqual([0, 3]);
    // On to the next chapter, eight minutes of reading later.
    const on = storyRead(begun, "book", 4, 100 + STRETCH_MINUTES, DAY, "A Book");
    expect(on.parcels).toBe(1);
    expect(on.events[0].text).toBe("A parcel came up the path, from “A Book”.");
    // The same chapter again, or an earlier one: nothing.
    expect(storyRead(on, "book", 4, 200, DAY)).toBe(on);
    expect(storyRead(on, "book", 2, 200, DAY)).toBe(on);
  });

  it("is not had by turning to the next chapter without reading this one", () => {
    const begun = storyRead(camp(), "book", 0, 100, DAY);
    // Twenty chapters turned in a minute.
    let turned = begun;
    for (let chapter = 1; chapter <= 20; chapter++) turned = storyRead(turned, "book", chapter, 101, DAY);
    expect(turned).toBe(begun);
    // Read for eight minutes, and one comes: one, however many chapters were turned.
    let read = begun;
    for (let chapter = 1; chapter <= 20; chapter++) read = storyRead(read, "book", chapter, 100 + STRETCH_MINUTES, DAY);
    expect(read.parcels).toBe(1);
    // An hour of it is seven of them at the very most.
    let hour = begun;
    for (let minute = 1; minute <= 60; minute++) hour = storyRead(hour, "book", minute, 100 + minute, DAY);
    expect(hour.parcels).toBeLessThanOrEqual(Math.min(PARCELS_MOST, Math.floor(60 / STRETCH_MINUTES)));
  });

  it("starts from where another book is opened, with nothing for what is behind the bookmark", () => {
    const one = storyRead(storyRead(camp(), "one", 0, 100, DAY), "one", 1, 120, DAY);
    expect(one.parcels).toBe(1);
    const other = storyRead(one, "other", 14, 121, DAY);
    expect([other.parcels, other.story?.mark]).toEqual([1, 14]);
    expect(storyRead(other, "other", 15, 121 + STRETCH_MINUTES, DAY).parcels).toBe(2);
  });

  it("waits by the door, up to 99 (six until 1.5.10), and is opened for a few acorns", () => {
    let full = storyRead(camp(), "book", 0, 0, DAY);
    for (let chapter = 1; chapter <= 120; chapter++) full = storyRead(full, "book", chapter, chapter * STRETCH_MINUTES, DAY);
    expect(full.parcels).toBe(PARCELS_MOST);
    expect(PARCELS_MOST).toBe(99);
    const opened = openParcel(full);
    expect([opened.parcels, opened.acorns]).toEqual([PARCELS_MOST - 1, parcelGives(full)]);
    expect(openParcel({ ...camp(), parcels: 0 }).acorns).toBe(0);
    // More in a bigger camp.
    expect(parcelGives(mine({ levels: { burrow: 5, oak: 1, store: 1, fence: 1, tower: 1, hut: 1 } }))).toBeGreaterThan(parcelGives(mine({ levels: { burrow: 1, oak: 1, store: 1, fence: 1, tower: 1, hut: 1 } })));
  });
});

describe("the gate", () => {
  const fenced = (fence: number) => fronted(mine({ levels: { burrow: 4, oak: 1, store: 1, fence, tower: 1, hut: 1 } }));

  it("is where the trail meets the wall, from the second level of the fence", () => {
    expect(gateOf(fenced(1))).toBeNull();
    const gated = fenced(GATE_FROM);
    expect(gateOf(gated)).toEqual([gated.front.x, 84]);
    expect(gated.walls).toContainEqual(gateOf(gated));
  });

  it("is down while a friend has knocked its section down, and back when it is put back", () => {
    const gated = fenced(GATE_FROM);
    const down = fronted({ ...gated, downed: [gateOf(gated)!] });
    expect(gateOf(down)).toBeNull();
    expect(down.walls).toHaveLength(gated.walls.length - 1);
    expect(gateOf(fronted({ ...down, downed: [] }))).toEqual(gateOf(gated));
  });
});

describe("the wall, slid", () => {
  const fenced = () => fronted(mine({ levels: { burrow: 4, oak: 1, store: 1, fence: 3, tower: 1, hut: 1 } }));

  it("goes along the trail with its gate and every section, and stays where it is put", () => {
    const base = fenced();
    const [least] = wallRange(base);
    const slid = slideWall(base, least);
    expect(slid.front.x).toBe(least);
    expect(slid.front.set).toBe(true);
    expect(gateOf(slid)).toEqual([least, 84]);
    expect(slid.walls.map(([, y]) => y)).toEqual(base.walls.map(([, y]) => y));
    // Set where it already is, nothing has happened.
    expect(slideWall(slid, least)).toBe(slid);
  });

  it("is never slid into the trees, nor past a building: nothing is left outside it", () => {
    const base = fenced();
    const [least, most] = wallRange(base);
    expect(slideWall(base, -50).front.x).toBe(least);
    expect(slideWall(base, 500).front.x).toBe(most);
    // The leftmost building (the oak, where a camp begins) stands behind the wall at its furthest.
    const far = slideWall(base, most);
    const oak = far.spots.oak;
    const at = far.walls.find(([, y]) => Math.abs(y - oak[1]) <= 5) ?? far.walls[0];
    expect(oak[0]).toBeGreaterThan(at[0]);
  });

  it("keeps buildings off the trail's side of it", () => {
    const base = fenced();
    const line = base.front.x;
    expect(spotBlocked(base, "store", line - 10, 100)).toBe("fence");
    expect(spotBlocked(base, "store", line + 40, 100)).toBeNull();
  });
});
