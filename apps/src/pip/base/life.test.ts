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
  dewWaits,
  finishRaid,
  gather,
  grantWant,
  heroWith,
  minutesOf,
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
import { heroTraits } from "./heroes";

// A winter day: the season does nothing to a gathering (in autumn the oak gives a fifth more, which has its own test).
const DAY = "2026-01-12";
const NEXT_DAY = "2026-01-13";
const at = (minutes: number, more: Partial<Now> = {}): Now => ({ minutes, day: DAY, lit: false, ...more });
const camp = (change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}): BaseState => {
  const fresh = newBase(1000, DAY);
  return { ...fresh, ...change, levels: { ...fresh.levels, ...levels } };
};
/** A camp one hero has come to: the librarian, who comes with any book finished. */
const lived = (change: Partial<BaseState> = {}, levels: Partial<Record<BuildingId, number>> = {}) => raise(camp({ acorns: 100, ...change }, { store: 2, ...levels }), "book-a", "A Book", DAY, 0);
/** The days from one on, for finding a day on which a hero wants a given thing. */
const days = Array.from({ length: 120 }, (_, index) => `2027-${String(1 + Math.floor(index / 28)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")}`);
const dayWhen = (state: BaseState, hero: number, wants: RegExp) => days.find((day) => wants.test(wantOf(state, hero, { ...at(1000), day })?.text ?? ""))!;

describe("the first acorns of the day", () => {
  it("come with one more fall of the oak, once a day, and never more than was gathered", () => {
    const state = camp({ acorns: 0, oakFrom: 0 }, { store: 3 });
    const drop = oakDrops(state);
    expect(dewWaits(state, DAY)).toBe(true);
    // Three falls on the tree: the dew is one fall more.
    const first = gather(state, 30, 0, DAY);
    expect(first.acorns).toBe(drop * 3 + drop);
    expect(first.dewDay).toBe(DAY);
    expect(dewWaits(first, DAY)).toBe(false);
    // Again the same day: only what the tree has.
    expect(gather(first, 60, 0, DAY).acorns - first.acorns).toBe(drop * 3);
    // And tomorrow it is there again.
    expect(gather(first, 60, 0, NEXT_DAY).acorns - first.acorns).toBe(drop * 4);
    // Gathered without a day (the old call): no dew, and none used up.
    expect(gather(state, 30).acorns).toBe(drop * 3);
    expect(gather(state, 30).dewDay).toBeNull();
  });

  it("is worth most to the reader who reads least", () => {
    const state = camp({ acorns: 0, oakFrom: 0 }, { store: 5 });
    const share = (minutes: number) => gather(state, minutes, 0, DAY).acorns / gather(state, minutes).acorns;
    expect(share(10)).toBe(2);
    expect(share(60)).toBeLessThan(1.2);
  });
});

describe("Pip's mood, from the house", () => {
  it("makes her build quicker when she is happy, and never slower when she is not", () => {
    expect([undefined, 0, 40, 74, 75, 89, 90, 100].map(moodQuicker)).toEqual([0, 0, 0, 0, 0.1, 0.1, 0.2, 0.2]);
    const state = camp({ acorns: 500 }, { burrow: 3 });
    const plain = minutesOf(state, "store", 2);
    expect(minutesOf(state, "store", 2, 30)).toBe(plain);
    expect(minutesOf(state, "store", 2, 95)).toBe(Math.round(plain * 0.8));
    // What a job needs is settled when it is begun, with the mood she was in then.
    expect(build(state, "store", 1000, undefined, 95).jobs[0].needs).toBe(minutesOf(state, "store", 1, 95));
    expect(build(state, "store", 1000).jobs[0].needs).toBe(minutesOf(state, "store", 1));
  });
});

describe("the people of the camp", () => {
  it("are the heroes who have come, each with one want a day that is reading or what reading pays for", () => {
    expect(residents(camp())).toEqual([]);
    expect(wantOf(camp(), 0, at(1000))).toBeNull();
    const state = lived();
    expect(residents(state).map((hero) => hero.id)).toEqual([0]);
    const want = wantOf(state, 0, at(1000))!;
    expect(want).toMatchObject({ hero: 0, granted: false, reward: 6 });
    expect(wantOf(state, 0, at(1000))).toEqual(want);
    // Over the days it is not always the same thing, and it is only ever one of these.
    const said = new Set(days.map((day) => wantOf(state, 0, { ...at(1000), day })!.text.replace(/\d+/, "N")));
    expect(said.size).toBeGreaterThan(2);
    for (const text of said) expect(text).toMatch(/^(Read for N minutes today|Gather the oak's acorns today|Meet your reading goal today)$/);
    // A raid is asked for only of a camp with a hut, and a thing for the clearing only once the burrow has grown.
    const grown = lived({}, { burrow: 2, hut: 1 });
    const more = new Set(days.map((day) => wantOf(grown, 0, { ...at(1000), day })!.text));
    expect([...more].some((text) => text === "Take me on a raid, and win it")).toBe(true);
    expect([...more].some((text) => /^I should like an? .+ in the clearing$/.test(text))).toBe(true);
  });

  it("come true by reading, and are seen to once for a step of friendship and a few acorns", () => {
    const state = lived();
    const day = dayWhen(state, 0, /^Read for/);
    const minutes = Number(/\d+/.exec(wantOf(state, 0, { ...at(1000), day })!.text)![0]);
    const before: Now = { ...at(1000), day, today: minutes - 1 };
    const after: Now = { ...before, today: minutes };
    expect(wantOf(state, 0, before)!.done).toBe(false);
    expect(grantWant(state, 0, before)).toBe(state);
    expect(wantWaits(state, before)).toBe(false);
    expect(wantWaits(state, after)).toBe(true);
    expect(campWaits({ ...state, visitor: day, night: day, quest: 99, wishDay: day }, after)).toBe(true);
    const seen = grantWant(settle(state, after), 0, after);
    expect(bondOf(seen, 0)).toBe(1);
    expect(seen.acorns).toBe(state.acorns + 6);
    expect(seen.events[0].text).toBe("Marian is settling in.");
    expect(wantOf(seen, 0, after)).toMatchObject({ done: true, granted: true, reward: 8 });
    expect(grantWant(seen, 0, after)).toBe(seen);
    // The next day there is another want, and yesterday's is not held against it.
    const morning: Now = { ...at(1000), day: "2099-01-01" };
    expect(wantOf(settle(seen, morning), 0, morning)!.granted).toBe(false);
  });

  it("are seen to by the oak gathered, the goal met, a raid won with them, or a thing set down", () => {
    const state = lived({}, { burrow: 2, hut: 2 });
    const gatherDay = dayWhen(state, 0, /^Gather/);
    expect(wantOf(gather({ ...state, oakFrom: 0 }, 1000, 0, gatherDay), 0, { ...at(1000), day: gatherDay })!.done).toBe(true);
    const goalDay = dayWhen(state, 0, /^Meet/);
    expect(wantOf(state, 0, { ...at(1000), day: goalDay, goalMet: true })!.done).toBe(true);

    const raidDay = dayWhen(state, 0, /^Take me/);
    const now: Now = { ...at(1000), day: raidDay };
    const set = settle(chooseHero(state, 0), now);
    const begun = startRaid(set, "camp", now)!;
    expect(begun.raid.setup.hero).toMatchObject({ id: 0 });
    const lost = finishRaid(begun.state, begun.raid, { stars: 0, destroyed: 0.1, hoards: 0 }, raidDay);
    expect(wantOf(lost.state, 0, now)!.done).toBe(false);
    const won = finishRaid(begun.state, begun.raid, { stars: 2, destroyed: 0.7, hoards: 1 }, raidDay);
    expect(wantOf(won.state, 0, now)!.done).toBe(true);

    // The thing wanted is still the thing wanted once it is there: the want does not move on for being met.
    const decorDay = dayWhen(state, 0, /^I should like/);
    const then: Now = { ...at(1000), day: decorDay };
    const asked = settle(state, then);
    const text = wantOf(asked, 0, then)!.text;
    const kind = DECOR.findIndex((thing) => text.includes(thing.name.toLowerCase()));
    expect(kind).toBeGreaterThanOrEqual(0);
    const placed = placeDecor({ ...asked, acorns: 500 }, kind, 100, 100);
    expect(wantOf(placed, 0, then)).toMatchObject({ text, done: true });
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

describe("Pip's walks", () => {
  const home = camp({ acorns: 0 }, { store: 3, oak: 2 });

  it("last as long as the reading does: she is back when the minutes are read, and not before", () => {
    expect(tripLeft(home, 1000)).toBeNull();
    expect(sendOut(home, 1000, 15)).toBe(home);
    const out = sendOut(home, 1000, 20);
    expect(out.trip).toEqual({ from: 1000, needs: 20 });
    expect(sendOut(out, 1000, 10)).toBe(out);
    expect(tripLeft(out, 1000)).toBe(20);
    expect(tripLeft(out, 1012)).toBe(8);
    expect(welcomeBack(out, 1012, DAY)).toBe(out);
    expect(tripLeft(out, 1500)).toBe(0);
    expect(campWaits({ ...out, visitor: DAY, night: DAY, quest: 99, wishDay: DAY, oakFrom: 1500 }, at(1500))).toBe(true);
  });

  it("bring back a share of what the oak gave for those minutes, and a tale not told before", () => {
    const out = sendOut(home, 1000, 20);
    const brings = tripBrings(out)!;
    expect(brings.acorns).toBe(Math.round(2 * oakDrops(home) * 0.4));
    expect(brings.tale).not.toBeNull();
    const back = welcomeBack(out, 1020, DAY);
    expect(back).toMatchObject({ acorns: brings.acorns, trip: null, tales: [brings.tale] });
    expect(back.events[0].text).toBe(`Pip came back from her walk with ${brings.acorns} acorns, and a tale.`);
    // The longer the walk, the more she has; and it is always less than the oak's own for the same reading.
    const [short, , long] = TRIPS.map((needs) => tripBrings(sendOut(home, 1000, needs))!.acorns);
    expect(long).toBeGreaterThan(short);
    for (const needs of TRIPS) expect(tripBrings(sendOut(home, 1000, needs))!.acorns).toBeLessThan((needs / 10) * oakDrops(home));
  });

  it("find every tale once, and then come back with acorns alone", () => {
    let state = home;
    let minutes = 1000;
    for (let walk = 0; walk < TALES.length; walk++) {
      state = welcomeBack(sendOut({ ...state, acorns: 0 }, minutes, 30), minutes + 30, DAY);
      minutes += 30;
    }
    expect([...state.tales].sort((a, b) => a - b)).toEqual(TALES.map((_, tale) => tale));
    expect(tripBrings(sendOut(state, minutes, 30))!.tale).toBeNull();
    expect(new Set(TALES).size).toBe(TALES.length);
    for (const tale of TALES) expect(tale.length).toBeLessThanOrEqual(110);
  });

  it("start again from here in a library restored from before she set out", () => {
    const out = sendOut(home, 5000, 10);
    expect(settle(out, at(1000)).trip).toEqual({ from: 1000, needs: 10 });
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
