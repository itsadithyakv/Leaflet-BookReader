import { describe, expect, it } from "vitest";
import { GATE_FROM, newBase, placeWall, setGate, type BaseState } from "./rules";
import { TIPS, learnt, noTips, tipNow } from "./tips";

const DAY = "2026-10-13";
const camp = (more: Partial<BaseState> = {}): BaseState => ({ ...newBase(0, DAY), ...more });
const levels = (burrow: number, others: Partial<BaseState["levels"]> = {}) => ({ burrow, oak: 1, store: 0, fence: 0, tower: 0, hut: 0, ...others });

describe("Pip's tips", () => {
  it("are each said in a line or two, and have names of their own", () => {
    expect(new Set(TIPS.map((tip) => tip.id)).size).toBe(TIPS.length);
    for (const tip of TIPS) {
      expect(tip.text.length, tip.id).toBeLessThanOrEqual(170);
      expect(tip.text.length, tip.id).toBeGreaterThan(30);
    }
  });

  it("begin with the oak on a new camp, then a building, then moving it", () => {
    const fresh = camp();
    expect(tipNow(fresh)?.id).toBe("oak");
    // Gathered: the oak needs no saying, and it is a building next.
    const gathered = { ...fresh, stats: { ...fresh.stats, gathered: 12 } };
    expect(tipNow(gathered)?.id).toBe("build");
    // Three things standing: now they can be moved about.
    const built = { ...gathered, levels: levels(1, { store: 1, hut: 1 }) };
    expect(tipNow(built)?.id).toBe("move");
    // Told, or done: on to whatever matters next (the hut's scouts can raid).
    expect(tipNow(learnt(built, "move"))?.id).toBe("raid");
  });

  it("are not said to a reader who has already done the thing", () => {
    // A camp well under way, kept from before there were tips: nothing about the oak, building, raids, fence, guardians or constructs.
    let old = camp({
      levels: { burrow: 4, oak: 4, store: 4, fence: 3, tower: 3, hut: 3 },
      stats: { gathered: 900, raids: 12, stars: 20, nights: 9, wagers: 0 },
      camps: 6,
      guards: [1, 0, 0, 2, 0, 0, 0],
      works: [{ kind: 4, x: 100, y: 100 }]
    });
    for (const x of [100, 110, 120, 130]) old = placeWall(old, x, 114);
    old = setGate(old, 110, 114);
    const said: string[] = [];
    for (let turn = 0; turn < TIPS.length + 2; turn++) {
      const tip = tipNow(old);
      if (!tip) break;
      said.push(tip.id);
      old = learnt(old, tip.id);
    }
    // Only the things the camp cannot show it knows: that things are dragged, what a prowler is, and the postcard.
    expect(said).toEqual(["move", "prowler", "postcard"]);
    expect(tipNow(old)).toBeNull();
  });

  it("come when the thing they are about has come, and not before", () => {
    const small = learnt(learnt(learnt(camp({ levels: levels(1, { store: 1, hut: 0 }), stats: { gathered: 5, raids: 0, stars: 0, nights: 0, wagers: 0 } }), "oak"), "build"), "move");
    expect(tipNow(small)).toBeNull();
    // A parcel has come.
    expect(tipNow({ ...small, parcels: 1 })?.id).toBe("parcel");
    // A fence built, and not yet laid.
    expect(tipNow({ ...small, levels: levels(1, { store: 1, fence: 1 }) })?.id).toBe("fence");
    // The gate, only once there is fence enough for one and the fence is good enough.
    let fenced: BaseState = { ...small, levels: levels(2, { store: 1, fence: GATE_FROM }), taught: [...small.taught, "prowler"] };
    for (const x of [100, 110, 120, 130]) fenced = placeWall(fenced, x, 114);
    expect(tipNow(fenced)?.id).toBe("gate");
    expect(tipNow(setGate(fenced, 110, 114))).toBeNull();
    // Something knocked about.
    expect(tipNow({ ...small, harm: { store: 1 } })?.id).toBe("broken");
  });

  it("stop for good when the reader wants none", () => {
    const fresh = camp();
    const quiet = noTips(fresh);
    expect(tipNow(quiet)).toBeNull();
    expect(tipNow({ ...quiet, parcels: 3, harm: { store: 2 } })).toBeNull();
    // Said twice, it is kept once.
    expect(noTips(quiet)).toBe(quiet);
    // A name that is no tip's is not kept.
    expect(learnt(fresh, "nonsense")).toBe(fresh);
    expect(learnt(learnt(fresh, "oak"), "oak").taught).toEqual(["oak"]);
  });
});
