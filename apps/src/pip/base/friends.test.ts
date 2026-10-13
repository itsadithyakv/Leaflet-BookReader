import { describe, expect, it } from "vitest";
import { runAuto } from "./battle";
import {
  FRIEND_PRIZE,
  HELD_PRIZE,
  MEND_A_STAR,
  MEND_MOST,
  HARM_MOST,
  POST_REACH,
  REST_MS,
  WOUNDS_MOST,
  campStructures,
  isAsleep,
  movePost,
  postSpotOf,
  sleepers,
  woundFighter,
  woundsOf,
  woodAt,
  fixCost,
  fixSite,
  harmOf,
  harmSite,
  harmed,
  blocked,
  campOfShared,
  finishFriendRaid,
  friendBlocked,
  newBase,
  placeWall,
  readBase,
  settle,
  startFriendRaid,
  sufferRaids,
  wreckLeft,
  type BaseState,
  type SharedCamp
} from "./rules";

const DAY = "2026-10-12";
const NOW = { minutes: 600, day: DAY, lit: false };
const mine = (more: Partial<BaseState> = {}): BaseState => {
  const base = newBase(0, DAY);
  return { ...base, acorns: 100, levels: { burrow: 3, oak: 3, store: 3, fence: 2, tower: 2, hut: 3 }, ...more };
};
const THEIRS: SharedCamp = {
  levels: { burrow: 3, oak: 2, store: 3, fence: 1, tower: 3, hut: 2 },
  yard: [
    { kind: "hive", level: 1 },
    { kind: null, level: 0 }
  ],
  spots: { store: [200, 70], tower: [190, 84] },
  walls: [
    [170, 74],
    [170, 84]
  ],
  guards: [2, 0, 0, 0, 0, 0, 0]
};
const TOVAH = { handle: "tovah", name: "Tovah" };

describe("raiding a friend's camp", () => {
  it("stands their camp up as they laid it out, and as nothing more than a camp to fight over", () => {
    const camp = campOfShared(THEIRS, DAY);
    expect(camp.levels.tower).toBe(3);
    expect(camp.spots.store).toEqual([200, 70]);
    expect(camp.walls).toHaveLength(2);
    expect(camp.guards[0]).toBe(2);
    expect(camp.acorns).toBe(newBase(0, DAY).acorns);
    // What a card might carry that it should not is not taken on trust.
    const odd = campOfShared({ ...THEIRS, levels: { ...THEIRS.levels, burrow: 99 }, walls: [[9999, 9999]] }, DAY);
    expect(odd.levels.burrow).toBeLessThanOrEqual(5);
    expect(odd.walls.every(([x, y]) => x <= 240 && y <= 120)).toBe(true);
  });

  it("costs the scouts' rest and nothing else, and each friend once a day", () => {
    const base = mine();
    expect(friendBlocked(base, NOW, "tovah")).toBeNull();
    const begun = startFriendRaid(base, THEIRS, TOVAH, NOW)!;
    expect(begun.state.acorns).toBe(base.acorns);
    expect(begun.raid.plan.name).toBe("Tovah's camp");
    expect(begun.raid.structures.some((entry) => entry.kind === "hoard")).toBe(true);
    expect(friendBlocked(begun.state, NOW, "tovah")).toBe("today");
    expect(startFriendRaid(begun.state, THEIRS, TOVAH, NOW)).toBeNull();
    // Somebody else today, and the same friend tomorrow.
    expect(friendBlocked(begun.state, NOW, "another")).not.toBe("today");
    expect(friendBlocked(begun.state, { ...NOW, day: "2026-10-13" }, "tovah")).not.toBe("today");
    expect(friendBlocked(mine({ levels: { ...base.levels, hut: 0 } }), NOW, "tovah")).toBe("hut");
    expect(friendBlocked(mine({ raidFrom: NOW.minutes }), NOW, "tovah")).toBe("rest");
  });

  it("can be fought through, and a better-defended camp gives up less", () => {
    const begun = startFriendRaid(mine(), THEIRS, TOVAH, NOW)!;
    const result = runAuto(begun.raid.setup, "left", begun.raid.structures).result();
    expect(result.stars).toBeGreaterThanOrEqual(0);
    expect(result.stars).toBeLessThanOrEqual(3);
    const bare: SharedCamp = { levels: { burrow: 2, oak: 1, store: 1, fence: 0, tower: 0, hut: 0 }, yard: [] };
    const keep: SharedCamp = { ...THEIRS, levels: { burrow: 5, oak: 5, store: 5, fence: 5, tower: 5, hut: 5 }, guards: [3, 3, 3, 3, 3, 3, 3] };
    // From whichever side does best, as a reader who looks first would choose.
    const best = (camp: SharedCamp) =>
      (["left", "right", "top", "bottom"] as const)
        .map((side) => runAuto(begun.raid.setup, side, startFriendRaid(mine(), camp, TOVAH, NOW)!.raid.structures).result())
        .reduce((a, b) => (b.destroyed > a.destroyed ? b : a));
    const soft = best(bare);
    const hard = best(keep);
    expect(soft.destroyed).toBeGreaterThan(hard.destroyed);
    expect(soft.stars).toBeGreaterThanOrEqual(2);
    expect(hard.stars).toBeLessThan(soft.stars);
  });

  it("pays the raider a little from the game, never from the friend, and says how it went", () => {
    const begun = startFriendRaid(mine(), THEIRS, TOVAH, NOW)!;
    const won = finishFriendRaid(begun.state, begun.raid, { stars: 2, destroyed: 0.6, hoards: 1 }, DAY);
    expect(won.end).toMatchObject({ won: true, stars: 2, loot: 2 * FRIEND_PRIZE });
    expect(won.state.acorns).toBe(begun.state.acorns + 2 * FRIEND_PRIZE);
    expect(won.state.events[0].text).toBe("Raided Tovah's camp: 2 stars.");
    const lost = finishFriendRaid(begun.state, begun.raid, { stars: 0, destroyed: 0.1, hoards: 0 }, DAY);
    expect(lost.end).toMatchObject({ won: false, loot: 0 });
    expect(lost.state.events[0].text).toBe("Tovah's camp held against the scouts.");
  });
});

describe("being raided by a friend", () => {
  it("is good news when the camp held: acorns, and nothing to mend", () => {
    const base = mine();
    const after = sufferRaids(base, [{ name: "Tovah", stars: 0 }], 600, DAY);
    expect(after.wreck).toBeNull();
    expect(after.acorns).toBe(base.acorns + HELD_PRIZE);
    expect(after.events[0].text).toBe("The camp held against Tovah's scouts.");
  });

  it("costs a piece of fence a star and a little reading to mend, and never the larder", () => {
    let base = mine();
    base = placeWall(placeWall(placeWall(base, 100, 104), 110, 104), 120, 104);
    expect(base.walls).toHaveLength(3);
    const after = sufferRaids(base, [{ name: "Tovah", stars: 2 }], 600, DAY);
    expect(after.acorns).toBe(base.acorns);
    expect(after.walls).toHaveLength(1);
    expect(after.wreck).toEqual({ by: "Tovah", stars: 2, from: 600, needs: 2 * MEND_A_STAR });
    expect(wreckLeft(after, 603)).toBe(2 * MEND_A_STAR - 3);
    // Nothing new is begun while Pip is mending; what was going up goes on.
    expect(blocked(after, "oak")).toBe("mend");
    // Read off, it is mended, and building is open again.
    const mended = settle(after, { minutes: 600 + 2 * MEND_A_STAR, day: DAY, lit: false });
    expect(mended.wreck).toBeNull();
    expect(mended.events.some((event) => event.text === "The camp is mended.")).toBe(true);
    expect(blocked(mended, "oak")).not.toBe("mend");
  });

  it("is never more than twenty minutes to mend, however many came, and gets no worse for being left", () => {
    const base = mine();
    const many = sufferRaids(
      base,
      Array.from({ length: 6 }, (_, index) => ({ name: `Friend ${index}`, stars: 3 })),
      600,
      DAY
    );
    expect(many.wreck?.needs).toBe(MEND_MOST);
    // A month away and no reading: it wants exactly what it wanted.
    const later = settle(many, { minutes: 600, day: "2026-11-12", lit: false });
    expect(wreckLeft(later, 600)).toBe(MEND_MOST);
  });

  it("is not taken on trust: odd stars and names are tidied, and what is kept reads back", () => {
    const after = sufferRaids(mine(), [{ name: "  ", stars: 99 }], 600, DAY);
    expect(after.wreck).toMatchObject({ by: "A friend", stars: 3 });
    expect(readBase(JSON.parse(JSON.stringify(after)))?.wreck).toEqual(after.wreck);
    expect(readBase({ ...JSON.parse(JSON.stringify(after)), wreck: { by: 7, stars: "x" }, rivals: { day: 3, raided: [1, "ok"] } })).toMatchObject({ wreck: null, rivals: { day: "", raided: ["ok"] } });
  });
});

describe("a prowler who got through", () => {
  it("knocks about what he came for, four times at most, and never what is not built", () => {
    let base = mine();
    expect(harmed(base)).toEqual([]);
    base = harmSite(base, "store", DAY);
    expect(harmOf(base, "store")).toBe(1);
    expect(base.events[0].text).toBe("A prowler got to the larder.");
    // Over the days after (there is only so much they do in one): four knocks, and no more however many come.
    for (let knock = 0; knock < 10; knock++) base = harmSite(base, "store", `2026-11-${String(knock + 1).padStart(2, "0")}`);
    expect(harmOf(base, "store")).toBe(HARM_MOST);
    // Said once, not at every knock.
    expect(base.events.filter((event) => event.text.startsWith("A prowler got to"))).toHaveLength(1);
    expect(harmSite(mine({ levels: { ...mine().levels, tower: 0 } }), "tower", DAY).harm).toEqual({});
  });

  it("costs acorns to put right, more for a better building, and holds up building on it until then", () => {
    const base = harmSite(harmSite(mine({ acorns: 100 }), "oak", DAY), "oak", DAY);
    expect(fixCost(base, "oak")).toBe(2 * (2 + 3));
    expect(blocked(base, "oak")).toBe("harm");
    // Everything else goes on as it was.
    expect(blocked(base, "tower")).not.toBe("harm");
    const fixed = fixSite(base, "oak");
    expect(fixed.acorns).toBe(100 - 10);
    expect(harmed(fixed)).toEqual([]);
    expect(blocked(fixed, "oak")).not.toBe("harm");
    // Not enough to pay with: it stays as it is.
    expect(fixSite({ ...base, acorns: 5 }, "oak")).toEqual({ ...base, acorns: 5 });
    expect(fixSite(mine(), "oak")).toEqual(mine());
  });

  it("is kept, and what is kept is not taken on trust", () => {
    const base = harmSite(mine(), "burrow", DAY);
    expect(readBase(JSON.parse(JSON.stringify(base)))?.harm).toEqual({ burrow: 1 });
    expect(readBase({ ...JSON.parse(JSON.stringify(base)), harm: { burrow: 99, oak: "x", shed: 2 } })?.harm).toEqual({ burrow: HARM_MOST });
  });
});

describe("a guardian's signpost", () => {
  const posted = (): BaseState => ({ ...mine(), guards: [2, 0, 0, 1, 2, 0, 0] });

  it("starts beside their building, and goes wherever it is carried", () => {
    const base = posted();
    const first = postSpotOf(base, 0)!;
    // Beside the lookout, not on it.
    expect(Math.hypot(first[0] - base.spots.tower[0], first[1] - base.spots.tower[1])).toBeGreaterThan(5);
    expect(Math.hypot(first[0] - base.spots.tower[0], first[1] - base.spots.tower[1])).toBeLessThan(20);
    const moved = movePost(base, 0, 60, 90);
    expect(postSpotOf(moved, 0)).toEqual([60, 90]);
    // Kept on the grass the camp has cleared, wherever it is let go.
    expect(postSpotOf(movePost(base, 0, 9999, -50), 0)).toEqual([232 - woodAt(base.levels.burrow), 52]);
    expect(readBase(JSON.parse(JSON.stringify(moved)))?.posts).toEqual({ 0: [60, 90] });
  });

  it("is not for one who is not posted, nor for the dragon, who keeps to her roof", () => {
    const base = posted();
    expect(movePost(base, 1, 60, 90)).toBe(base);
    expect(movePost(base, 4, 60, 90)).toBe(base);
    expect(postSpotOf(base, 4)).toBeNull();
  });

  it("is where they stand in the night's fight, and throw at what comes near", () => {
    const moved = movePost(posted(), 0, 60, 90);
    const sentry = campStructures(moved, false).find((entry) => entry.look?.name === "guardian" && entry.look.variant === 0)!;
    expect([sentry.x, sentry.y]).toEqual([60, 90]);
    expect(sentry.range).toBe(POST_REACH - 3);
    expect(sentry.hit).toBe(3);
    // One for each of them on the ground, and none for the dragon.
    expect(campStructures(moved, false).filter((entry) => entry.look?.name === "guardian").map((entry) => entry.look?.variant)).toEqual([0, 3]);
  });
});

describe("worn out", () => {
  const AT = 1_800_000_000_000;
  const HOUR = 60 * 60 * 1000;
  const posted = (): BaseState => ({ ...mine(), guards: [2, 1, 0, 1, 2, 0, 0], walls: [[100, 104]] });

  it("comes at the third knock, lasts three hours by the clock, and mends by itself", () => {
    let base = posted();
    base = woundFighter(base, 0, AT, DAY);
    base = woundFighter(base, 0, AT + 1000, DAY);
    expect(woundsOf(base, 0, AT + 2000)).toBe(2);
    expect(isAsleep(base, 0, AT + 2000)).toBe(false);
    base = woundFighter(base, 0, AT + 2000, DAY);
    expect(isAsleep(base, 0, AT + 3000)).toBe(true);
    expect(sleepers(base, AT + 3000)).toEqual([0]);
    expect(base.events[0].text).toBe("Halvar is worn out, and asleep for a few hours.");
    // Nothing more happens to one who is asleep.
    expect(woundFighter(base, 0, AT + 4000, DAY)).toBe(base);
    expect(isAsleep(base, 0, AT + 2000 + REST_MS - 1)).toBe(true);
    expect(isAsleep(base, 0, AT + 2000 + REST_MS + 1)).toBe(false);
    // Slept off, they start fresh.
    expect(woundsOf(base, 0, AT + 2000 + REST_MS + 1)).toBe(0);
  });

  it("is shaken off in an hour when it never came to that", () => {
    const base = woundFighter(woundFighter(posted(), 3, AT, DAY), 3, AT + 1000, DAY);
    expect(woundsOf(base, 3, AT + HOUR)).toBe(2);
    expect(woundsOf(base, 3, AT + 1000 + HOUR + 1)).toBe(0);
    // And a knock after that is the first again.
    expect(woundsOf(woundFighter(base, 3, AT + 2 * HOUR, DAY), 3, AT + 2 * HOUR)).toBe(1);
    expect(WOUNDS_MOST).toBe(3);
  });

  it("takes them out of the night's fight, and is nobody's business when no clock is said", () => {
    let base = posted();
    for (let knock = 0; knock < 3; knock++) base = woundFighter(base, 0, AT + knock, DAY);
    const there = (state: BaseState, at?: number) =>
      campStructures(state, false, at)
        .filter((entry) => entry.look?.name === "guardian")
        .map((entry) => entry.look?.variant);
    expect(there(base, AT + 10)).toEqual([1, 3]);
    expect(there(base)).toEqual([0, 1, 3]);
    expect(there(base, AT + REST_MS + 10)).toEqual([0, 1, 3]);
  });

  it("is what a friend's raid of two stars or more does to every guardian on the ground", () => {
    const light = sufferRaids(posted(), [{ name: "Tovah", stars: 1 }], 600, DAY, AT);
    expect(sleepers(light, AT + 1)).toEqual([]);
    const heavy = sufferRaids(posted(), [{ name: "Tovah", stars: 2 }], 600, DAY, AT);
    expect(sleepers(heavy, AT + 1).sort()).toEqual([0, 1, 3]);
    expect(isAsleep(heavy, 4, AT + 1)).toBe(false);
    expect(readBase(JSON.parse(JSON.stringify(heavy)))?.tired).toEqual(heavy.tired);
  });
});
