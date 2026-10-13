import { describe, expect, it } from "vitest";
import {
  moveWall,
  wallMoveBlocked,
  KNOCKS_A_DAY,
  THEFTS_A_DAY,
  GATE_FROM,
  PARCELS_MOST,
  STRETCH_MINUTES,
  gateOf,
  openParcel,
  parcelGives,
  removeWall,
  setGate,
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
  placeWall,
  restMs,
  spotBlocked,
  woundFighter,
  type BaseState
} from "./rules";

const DAY = "2026-10-13";
const AT = 1_800_000_000_000;
const mine = (more: Partial<BaseState> = {}): BaseState => ({ ...newBase(0, DAY), acorns: 500, levels: { burrow: 3, oak: 3, store: 3, fence: 2, tower: 2, hut: 3 }, ...more });
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
    // Knocked about, it still throws as far, and a tenth less hard for each knock.
    expect(lookout(knocked(base, "tower", HARM_MOST - 1)).range).toBe(lookout(base).range);
    expect(lookout(knocked(base, "tower", 1)).hit).toBeCloseTo(lookout(base).hit * 0.9, 6);
    expect(lookout(knocked(base, "tower", HARM_MOST - 1)).hit).toBeCloseTo(lookout(base).hit * 0.7, 6);
    const broken = knocked(base, "tower", HARM_MOST);
    expect([lookout(broken).range, lookout(broken).hit]).toEqual([0, 0]);
    const mended = fixSite(broken, "tower");
    expect(mended.acorns).toBe(broken.acorns - fixCost(broken, "tower"));
    expect(lookout(mended).range).toBe(lookout(base).range);
  });

  it("hides nothing, when it is the larder", () => {
    const base = mine();
    expect(hides(base)).toBeGreaterThan(0);
    // A tenth less for each knock, and then nothing.
    expect(hides(knocked(base, "store", 1))).toBe(Math.round(hides(base) * 0.9));
    expect(hides(knocked(base, "store", HARM_MOST - 1))).toBe(Math.round(hides(base) * 0.7));
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
  it("is six pieces of fence for every level of it, so that thirty go round a camp", () => {
    expect(fencePieces(mine({ levels: { burrow: 5, oak: 1, store: 1, fence: 5, tower: 1, hut: 1 } }))).toBe(30);
    expect(fencePieces(mine({ levels: { burrow: 2, oak: 1, store: 1, fence: 0, tower: 1, hut: 1 } }))).toBe(0);
    // Put down along a line, as many as there are and no more.
    let base = mine({ levels: { burrow: 5, oak: 1, store: 1, fence: 1, tower: 1, hut: 1 }, walls: [] });
    for (let piece = 0; piece < 12; piece++) base = placeWall(base, 60 + piece * 10, 114);
    expect(base.walls).toHaveLength(6);
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
    // A tenth fewer for each knock left unmended; broken, half.
    expect(oakDrops(knocked(base, "oak", 1))).toBeCloseTo(oakDrops(base) * 0.9, 6);
    expect(oakDrops(knocked(base, "oak", HARM_MOST - 1))).toBeCloseTo(oakDrops(base) * 0.7, 6);
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

  it("waits by the door, six at most, and is opened for a few acorns", () => {
    let full = storyRead(camp(), "book", 0, 0, DAY);
    for (let chapter = 1; chapter <= 10; chapter++) full = storyRead(full, "book", chapter, chapter * STRETCH_MINUTES, DAY);
    expect(full.parcels).toBe(PARCELS_MOST);
    const opened = openParcel(full);
    expect([opened.parcels, opened.acorns]).toEqual([PARCELS_MOST - 1, parcelGives(full)]);
    expect(openParcel({ ...camp(), parcels: 0 }).acorns).toBe(0);
    // More in a bigger camp.
    expect(parcelGives(mine({ levels: { burrow: 5, oak: 1, store: 1, fence: 1, tower: 1, hut: 1 } }))).toBeGreaterThan(parcelGives(mine({ levels: { burrow: 1, oak: 1, store: 1, fence: 1, tower: 1, hut: 1 } })));
  });
});

describe("the gate", () => {
  const fenced = (fence: number) => {
    let base = mine({ levels: { burrow: 4, oak: 1, store: 1, fence, tower: 1, hut: 1 }, walls: [] });
    for (const x of [100, 110, 120]) base = placeWall(base, x, 114);
    return base;
  };

  it("is made of a piece of the fence, one at a time, from the second level of it", () => {
    const base = fenced(GATE_FROM);
    expect(base.walls).toHaveLength(3);
    expect(gateOf(base)).toBeNull();
    const gated = setGate(base, 110, 114);
    expect(gateOf(gated)).toEqual([110, 114]);
    // Another piece made the gate: the first is a piece again.
    expect(gateOf(setGate(gated, 120, 114))).toEqual([120, 114]);
    // The gate itself, asked again, is a piece again.
    expect(gateOf(setGate(gated, 110, 114))).toBeNull();
    // Nothing is made a gate where there is no fence; nor of a fence of the first level.
    expect(setGate(base, 150, 80)).toBe(base);
    expect(gateOf(setGate(fenced(1), 110, 114))).toBeNull();
  });

  it("goes with its piece when the piece is taken up", () => {
    const gated = setGate(fenced(GATE_FROM), 110, 114);
    const taken = removeWall(gated, wallAt(gated, 110, 114));
    expect(taken.walls).toHaveLength(2);
    expect(gateOf(taken)).toBeNull();
  });
});

describe("a piece of fence, moved", () => {
  const fenced = () => {
    let base = mine({ levels: { burrow: 4, oak: 1, store: 1, fence: 2, tower: 1, hut: 1 }, walls: [] });
    for (const x of [100, 110, 120]) base = placeWall(base, x, 114);
    return base;
  };

  it("goes to the square it is set down on, and the rest stay where they are", () => {
    const base = fenced();
    const moved = moveWall(base, wallAt(base, 120, 114), 130, 114);
    expect(moved.walls).toEqual([[100, 114], [110, 114], [130, 114]]);
    // Onto the grid, wherever it is let go.
    expect(moveWall(base, 0, 53, 97).walls[0]).toEqual([50, 94]);
    // Set down where it was, nothing has happened.
    expect(moveWall(base, 0, 100, 114).walls).toEqual(base.walls);
  });

  it("is moved though every piece the fence allows is down, and not onto another piece or off the grass", () => {
    let full = mine({ levels: { burrow: 4, oak: 1, store: 1, fence: 1, tower: 1, hut: 1 }, walls: [] });
    // Along the back of the clearing, clear of every building.
    for (let piece = 0; piece < 6; piece++) full = placeWall(full, 100 + piece * 10, 64);
    expect(full.walls).toHaveLength(6);
    // No more may be put down; one of them may still be moved.
    expect(placeWall(full, 100, 114)).toBe(full);
    expect(wallMoveBlocked(full, 0, 100, 114)).toBeNull();
    expect(moveWall(full, 0, 100, 114).walls).toHaveLength(6);
    // Not onto another piece.
    expect(wallMoveBlocked(full, 0, 110, 64)).toBe("fence");
    expect(moveWall(full, 0, 110, 64)).toBe(full);
    // Nor up against a building.
    expect(wallMoveBlocked(full, 0, full.spots.burrow[0], full.spots.burrow[1])).toBe("building");
    // Nor a piece there is not.
    expect(moveWall(full, 99, 100, 114)).toBe(full);
  });

  it("takes the gate with it when it is the gate", () => {
    const gated = setGate(fenced(), 110, 114);
    const moved = moveWall(gated, wallAt(gated, 110, 114), 110, 64);
    expect(gateOf(moved)).toEqual([110, 64]);
    // Another piece moved leaves the gate where it is.
    expect(gateOf(moveWall(gated, wallAt(gated, 100, 114), 90, 114))).toEqual([110, 114]);
  });
});
