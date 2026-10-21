import { describe, expect, it } from "vitest";
import {
  BOND_MOST,
  DECOR,
  TALES,
  TRIPS,
  bondOf,
  bondWord,
  build,
  campWaits,
  chooseHero,
  finishRaid,
  gather,
  gatherBrings,
  openParcel,
  parcelGives,
  PARCELS_MOST,
  grantWant,
  heroWith,
  minutesOf,
  priceOf,
  moodQuicker,
  newBase,
  oakDrops,
  placeDecor,
  raise,
  readBase,
  residents,
  sendOut,
  settle,
  startRaid,
  tripBrings,
  tripLeft,
  wantOf,
  wantWaits,
  welcomeBack,
  type BaseState,
  type BuildingId,
  type Now
} from "./rules";
import { HEROES, heroTraits } from "./heroes";
import { BLADES, BLADE_AT_BOND } from "./guards";
import { bladesWon } from "./rules";
import { beforeChapters } from "./testing";

// A winter day: the season does nothing to a gathering (in autumn the oak gives a fifth more, which has its own test).
const DAY = "2026-01-12";
const NEXT_DAY = "2026-01-13";
const at = (minutes: number, more: Partial<Now> = {}): Now => ({ minutes, day: DAY, lit: false, ...more });
const camp = (change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}): BaseState => {
  const fresh = newBase(1000, DAY);
  return beforeChapters({ ...fresh, ...change, levels: { ...fresh.levels, ...levels } });
};
/** A camp one hero has come to: the librarian, who comes with any book finished. */
const lived = (change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}) => raise(camp({ acorns: 100, ...change }, { store: 2, ...levels }), "book-a", "A Book", DAY, 0);
/** The days from one on, for finding a day on which a hero wants a given thing. */
const days = Array.from({ length: 120 }, (_, index) => `2027-${String(1 + Math.floor(index / 28)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")}`);
const dayWhen = (state: BaseState, hero: number, wants: RegExp) => days.find((day) => wants.test(wantOf(state, hero, { ...at(1000), day })?.text ?? ""))!;

describe("a gathering", () => {
  it("brings what the tree has, the same on any day: the dew of the first gathering went on 2026-10-15", () => {
    const state = camp({ acorns: 0, oakFrom: 0 }, { store: 3 });
    const drop = oakDrops(state);
    const first = gather(state, 30, 0, DAY);
    expect(first.acorns).toBe(drop * 3);
    expect(first.dewDay).toBeNull();
    expect(gather(first, 60, 0, DAY).acorns - first.acorns).toBe(drop * 3);
    expect(gather(first, 60, 0, NEXT_DAY).acorns - first.acorns).toBe(drop * 3);
    // What the screen says before the tap is what the tap brings, a streak and the season counted in.
    expect(gatherBrings(state, 30, 14, "2026-10-12")).toBe(gather(state, 30, 14, "2026-10-12").acorns - state.acorns);
    // And all of it, however many acorns the camp has (1.5.10: there is no brim).
    expect(gatherBrings({ ...state, acorns: 1395 }, 30, 0, DAY)).toBe(drop * 3);
  });
});

describe("Pip's mood, from the house", () => {
  it("makes her build quicker when she is happy, and never slower when she is not", () => {
    expect([undefined, 0, 40, 74, 75, 89, 90, 100].map(moodQuicker)).toEqual([0, 0, 0, 0, 0.1, 0.1, 0.2, 0.2]);
    const state = camp({ acorns: 500 }, { burrow: 3 });
    const plain = minutesOf(state, "store", 2);
    expect(minutesOf(state, "store", 2, 30)).toBe(plain);
    expect(minutesOf(state, "store", 2, 95)).toBe(Math.round(plain * 0.8));
    // Her work is part of a building's price: a happy Pip makes it cheaper, and she is paid what she was when it was built.
    expect(priceOf(state, "store", 2, 95)).toBeLessThan(priceOf(state, "store", 2));
    expect(priceOf(state, "store", 2, 30)).toBe(priceOf(state, "store", 2));
    expect(build(state, "store", 1000, undefined, 95).acorns).toBe(500 - priceOf(state, "store", 1, 95));
    expect(build(state, "store", 1000).acorns).toBe(500 - priceOf(state, "store", 1));
  });
});

describe("the people of the camp", () => {
  it("are the heroes who have come; their daily wants are not asked since 2026-10-15, and a day's goal met sends a parcel instead", () => {
    expect(residents(camp())).toEqual([]);
    const state = lived();
    expect(residents(state).map((hero) => hero.id)).toEqual([0]);
    const goal: Now = { ...at(1000), goalMet: true };
    const met = settle(state, goal);
    expect(met.parcels).toBe(state.parcels + 1);
    expect(met.wishDay).toBe(DAY);
    // Once a day.
    expect(settle(met, goal).parcels).toBe(met.parcels);
    expect(settle(met, { ...goal, day: NEXT_DAY }).parcels).toBe(met.parcels + 1);
    // Not met, nothing.
    expect(settle(state, at(1000)).parcels).toBe(state.parcels);
    // A friend made before then is still a friend.
    expect(bondOf({ ...state, bonds: state.bonds.map((_, hero) => (hero === 0 ? 2 : 0)) }, 0)).toBe(2);
  });

  it("grow fonder of the camp with each day's goal met, so a hero's own blade can still be had", () => {
    // Piers, who gives Undertow as a friend, brought by the books he comes for.
    const piers = HEROES[2];
    const blade = BLADES.find((entry) => entry.hero === 2)!;
    const state = lived({ shelf: lived().shelf.map((count, kind) => (kind === piers.kinds[0] ? piers.need : count)) });
    expect(residents(state).map((hero) => hero.id)).toContain(2);
    let now = state;
    for (const [index, day] of days.slice(0, BLADE_AT_BOND).entries()) {
      now = settle({ ...now, parcels: 0 }, { ...at(1000), day, goalMet: true });
      expect(bondOf(now, 2)).toBe(index + 1);
      expect(bondOf(now, 0)).toBe(index + 1);
    }
    expect(bladesWon(now)).toContain(blade.id);
    expect(now.events.some((event) => event.text.includes(blade.name))).toBe(true);
    // A day not met, or the parcel already sent, brings nobody closer.
    expect(settle(now, { ...at(1000), day: days[BLADE_AT_BOND - 1], goalMet: true }).bonds).toEqual(now.bonds);
    expect(settle(now, { ...at(1000), day: days[BLADE_AT_BOND] }).bonds).toEqual(now.bonds);
    // And no further than sworn.
    const sworn = { ...state, bonds: state.bonds.map(() => BOND_MOST) };
    expect(settle(sworn, { ...at(1000), goalMet: true }).bonds).toEqual(sworn.bonds);
  });

  it("go no further than sworn, and a hero who knows the camp is a little stronger on a raid", () => {
    expect(bondWord(0)).toBe("new here");
    expect(bondWord(BOND_MOST)).toBe("sworn to the Hollow");
    const fresh = chooseHero(lived(), 0);
    const sworn = { ...fresh, bonds: fresh.bonds.map((_, hero) => (hero === 0 ? 99 : 0)) };
    expect(bondOf(sworn, 0)).toBe(BOND_MOST);
    const plain = heroTraits(0)!;
    expect(heroWith(fresh)).toMatchObject({ hp: plain.hp, dps: plain.dps });
    expect(heroWith(sworn)!.hp).toBe(Math.round(plain.hp * 1.15));
    expect(heroWith(sworn)!.dps).toBeGreaterThan(plain.dps);
    expect(heroWith(sworn)!.dps).toBeLessThan(plain.dps * 1.2);
  });
});

describe("Pip's walks, and the tales", () => {
  const home = camp({ acorns: 0 }, { store: 3, oak: 2 });

  it("are not sent since 2026-10-15; one from a camp kept before comes back as a parcel once it is read through", () => {
    const out = { ...home, trip: { from: 1000, needs: 20 } };
    expect(tripLeft(out, 1012)).toBe(8);
    expect(settle(out, at(1012)).trip).toEqual({ from: 1000, needs: 20 });
    const back = settle(out, at(1020));
    expect(back.trip).toBeNull();
    expect(back.parcels).toBe(out.parcels + 1);
    // A walk that started after the reading the library now has starts again from here.
    expect(settle({ ...home, trip: { from: 5000, needs: 10 } }, at(1000)).trip).toEqual({ from: 1000, needs: 10 });
  });

  it("come in parcels now: every other one or so has a tale in it, each found once", () => {
    let state: BaseState = { ...home, acorns: 0, parcels: 0 };
    let opened = 0;
    for (let round = 0; round < 400 && state.tales.length < TALES.length; round++) {
      state = { ...state, acorns: 0, parcels: 1, stats: { ...state.stats, gathered: state.stats.gathered + 1 } };
      const after = openParcel(state);
      expect(after.acorns).toBe(parcelGives(state));
      state = after;
      opened++;
    }
    expect([...state.tales].sort((a, b) => a - b)).toEqual(TALES.map((_, tale) => tale));
    expect(opened).toBeGreaterThan(TALES.length);
    expect(new Set(TALES).size).toBe(TALES.length);
    for (const tale of TALES) expect(tale.length).toBeLessThanOrEqual(110);
  });

  it("wait, and are never lost: a parcel is opened whole, however many acorns the camp has", () => {
    const full = { ...home, acorns: 1400, parcels: 2 };
    expect(openParcel(full)).toMatchObject({ parcels: 1, acorns: 1400 + parcelGives(home) });
    expect(PARCELS_MOST).toBe(99);
  });

  it("are what the dot on the way in is for, with a building finished and a full oak: nothing that asks to be come back for", () => {
    const quiet = camp({ oakFrom: 1000, acorns: 0 }, { store: 3 });
    expect(campWaits(quiet, at(1000))).toBe(false);
    expect(campWaits({ ...quiet, parcels: 1 }, at(1000))).toBe(true);
    // However many acorns the camp has: there is always room (1.5.10).
    expect(campWaits({ ...quiet, parcels: 1, acorns: 1400 }, at(1000))).toBe(true);
    // A day turned, a hedgehog, a fence not put down: none of them is a dot.
    expect(campWaits({ ...quiet, visitor: null, night: "2020-01-01", levels: { ...quiet.levels, fence: 1, burrow: 3 } }, at(1000))).toBe(false);
  });
});

describe("a camp kept before any of this", () => {
  it("reads as one that never used it, and what is kept of it comes back as it was", () => {
    const old = JSON.parse(JSON.stringify(newBase(1000, DAY))) as Record<string, unknown>;
    for (const part of ["dewDay", "bonds", "wants", "trip", "tales"]) delete old[part];
    const read = readBase(old)!;
    expect(read).toMatchObject({ dewDay: null, trip: null, tales: [] });
    expect(read.bonds).toEqual(newBase(1000, DAY).bonds);
    expect(read.wants).toEqual({ day: "", done: [], won: [], set: [] });

    const kept = { ...newBase(1000, DAY), dewDay: DAY, bonds: [3, 99, -1, 0, 0, 0, 0, 0, 0, 0], wants: { day: DAY, done: [0, 0, 42], won: [1], set: [2, 2, 99] }, trip: { from: 900, needs: 20 }, tales: [4, 4, 999, 7] };
    const back = readBase(JSON.parse(JSON.stringify(kept)))!;
    expect(back.dewDay).toBe(DAY);
    expect(back.bonds.slice(0, 3)).toEqual([3, BOND_MOST, 0]);
    expect(back.wants).toEqual({ day: DAY, done: [0, 9], won: [1], set: [2, DECOR.length - 1] });
    expect(back.trip).toEqual({ from: 900, needs: 20 });
    expect(back.tales).toEqual([4, 35, 7]);
    // A walk of a length nobody can ask for is no walk.
    expect(readBase(JSON.parse(JSON.stringify({ ...kept, trip: { from: 900, needs: 45 } })))!.trip).toBeNull();
  });
});
