import { describe, expect, it } from "vitest";
import { POKE_RUNGS } from "../pip/play";
import { FIDGETS, THINK_JITTER_MS, THINK_MIN_MS, newBrain, pose, reduce, signShowing, type Brain, type Happening } from "./brain";

/** A dice that gives these rolls in turn, then 0.99 (which is "stay as you are"). */
const rolls = (...values: number[]) => {
  let next = 0;
  return () => (next < values.length ? values[next++] : 0.99);
};

/** Runs happenings through the brain, collecting what it asks of the host. */
const run = (brain: Brain, happenings: Happening[], now = 1000, rand = rolls()) => {
  const asked: string[] = [];
  let current = brain;
  for (const happening of happenings) {
    const step = reduce(current, happening, now, rand);
    current = step.brain;
    asked.push(...step.asks.map((ask) => ask.type));
  }
  return { brain: current, asked };
};

/** A Pip on her feet in the daytime, with a thought due. */
const awake = () => run(newBrain(), [{ type: "world", night: false, quiet: false }]).brain;

describe("desktop Pip, left alone", () => {
  it("stands still, and thinks of something to do in a while", () => {
    const brain = awake();
    expect(pose(brain)).toMatchObject({ move: "idle", still: true });
    expect(brain.thinkAt).toBeGreaterThanOrEqual(1000 + THINK_MIN_MS);
    expect(brain.thinkAt).toBeLessThanOrEqual(1000 + THINK_MIN_MS + THINK_JITTER_MS);
    // Not before her time.
    expect(reduce(brain, { type: "think" }, 1500, rolls(0.1)).asks).toEqual([]);
  });

  it("strolls: asks the host, walks when told she is walking, and stands again on arriving", () => {
    const brain = awake();
    const at = brain.thinkAt!;
    const asked = reduce(brain, { type: "think" }, at, rolls(0.2, 0.7, 0.9));
    expect(asked.asks).toEqual([{ type: "stroll", roll: 0.7, turn: false }]);
    // Until the host answers she has not moved, and is not thinking again.
    expect(pose(asked.brain).move).toBe("idle");
    expect(asked.brain.thinkAt).toBeNull();

    const walking = reduce(asked.brain, { type: "walking", facing: 1 }, at).brain;
    expect(pose(walking)).toMatchObject({ move: "walk", still: false, flip: false });
    expect(pose(reduce(asked.brain, { type: "walking", facing: -1 }, at).brain).flip).toBe(true);

    const arrived = reduce(walking, { type: "arrived" }, at + 4000).brain;
    expect(pose(arrived)).toMatchObject({ move: "idle", still: true });
    expect(arrived.thinkAt).toBeGreaterThan(at + 4000);
  });

  it("settles again when the host says there is nowhere to stroll", () => {
    const brain = awake();
    const asked = reduce(brain, { type: "think" }, brain.thinkAt!, rolls(0.2, 0.5, 0.9)).brain;
    const refused = reduce(asked, { type: "arrived" }, brain.thinkAt! + 5).brain;
    expect(refused.act.kind).toBe("stand");
    expect(refused.thinkAt).not.toBeNull();
  });

  it("sits down for a while, and gets up again", () => {
    const brain = awake();
    const sat = reduce(brain, { type: "think" }, brain.thinkAt!, rolls(0.5)).brain;
    expect(pose(sat)).toMatchObject({ move: "sit", still: true });
    const up = reduce(sat, { type: "think" }, sat.thinkAt!, rolls(0.5)).brain;
    expect(up.act.kind).toBe("stand");
  });

  it("fidgets once through and comes back to standing", () => {
    const brain = awake();
    const fidgeting = reduce(brain, { type: "think" }, brain.thinkAt!, rolls(0.7, 0.3)).brain;
    const drawn = pose(fidgeting);
    expect(FIDGETS).toContain(drawn.move);
    expect(drawn).toMatchObject({ loops: 1, still: false });
    expect(reduce(fidgeting, { type: "done" }, 9000).brain.act.kind).toBe("stand");
  });

  it("in quiet mode never strolls or fidgets", () => {
    let brain = run(newBrain(), [{ type: "world", night: false, quiet: true }]).brain;
    const seen = new Set<string>();
    for (const roll of [0.01, 0.2, 0.4, 0.6, 0.8, 0.99, 0.1, 0.5]) {
      const step = reduce(brain, { type: "think" }, brain.thinkAt!, rolls(roll));
      expect(step.asks).toEqual([]);
      brain = step.brain;
      seen.add(brain.act.kind);
      expect(brain.thinkAt).not.toBeNull();
    }
    expect([...seen].sort()).toEqual(["sit", "stand"]);
  });

  it("under reduced motion stands where she is put and never thinks of moving", () => {
    const brain = run(newBrain(true), [{ type: "world", night: false, quiet: false }]).brain;
    expect(brain.thinkAt).toBeNull();
    expect(reduce(brain, { type: "think" }, 999_999, rolls(0.1)).asks).toEqual([]);
    // Switched on mid-stroll, the stroll stops.
    const walking = run(awake(), [{ type: "walking", facing: 1 }]).brain;
    const stopped = reduce(walking, { type: "still", on: true }, 2000);
    expect(stopped.asks).toEqual([{ type: "halt" }]);
    expect(stopped.brain.act.kind).toBe("stand");
  });
});

describe("desktop Pip at night", () => {
  it("sleeps through the quiet hours, in one still pose, with nothing left to think about", () => {
    const brain = run(awake(), [{ type: "world", night: true, quiet: false }]).brain;
    expect(pose(brain)).toMatchObject({ move: "sleep", still: true });
    expect(brain.thinkAt).toBeNull();
  });

  it("stops a stroll at bedtime", () => {
    const walking = run(awake(), [{ type: "walking", facing: -1 }]).brain;
    const step = reduce(walking, { type: "world", night: true, quiet: false }, 3000);
    expect(step.asks).toEqual([{ type: "halt" }]);
    expect(step.brain.act.kind).toBe("sleep");
  });

  it("yawns when poked awake and goes back to sleep", () => {
    const asleep = run(awake(), [{ type: "world", night: true, quiet: false }]).brain;
    const poked = reduce(asleep, { type: "poke" }, 5000).brain;
    expect(pose(poked)).toMatchObject({ move: "yawn", loops: 1 });
    expect(reduce(poked, { type: "done" }, 9000).brain.act.kind).toBe("sleep");
  });

  it("stretches in the morning and starts her day", () => {
    const asleep = run(awake(), [{ type: "world", night: true, quiet: false }]).brain;
    const morning = reduce(asleep, { type: "world", night: false, quiet: false }, 5000).brain;
    expect(pose(morning).move).toBe("stretch");
    const up = reduce(morning, { type: "done" }, 9000).brain;
    expect(up.act.kind).toBe("stand");
    expect(up.thinkAt).not.toBeNull();
  });
});

describe("desktop Pip and the pointer", () => {
  it("looks at a pointer that comes near, and away when it leaves", () => {
    const brain = awake();
    const look = (side: number, up: boolean) => pose(reduce(brain, { type: "glance", side, up, near: true }, 1000).brain);
    expect(look(-1, false)).toMatchObject({ move: "eye-l", still: true, flip: false });
    expect(look(1, true).move).toBe("eye-ur");
    expect(look(0, true).move).toBe("eye-u");
    expect(look(0, false).move).toBe("idle");
    const away = run(brain, [
      { type: "glance", side: 1, up: false, near: true },
      { type: "glance", side: 0, up: false, near: false }
    ]).brain;
    expect(pose(away).move).toBe("idle");
  });

  it("answers each poke in a row differently, and forgets after a rest", () => {
    let brain = awake();
    const answers: string[] = [];
    for (let count = 0; count < POKE_RUNGS; count += 1) {
      brain = reduce(brain, { type: "poke" }, 2000 + count * 500).brain;
      answers.push(pose(brain).move);
      brain = reduce(brain, { type: "done" }, 2000 + count * 500 + 100).brain;
    }
    expect(answers).toEqual(["boop", "boop", "laugh", "dizzy", "steamed"]);
    // Past the last rung, a party piece, and the count starts over.
    const surprise = reduce(brain, { type: "poke" }, 5000).brain;
    expect(pose(surprise).move).toBe("cheer");
    expect(surprise.poke).toBeNull();
    // Left alone a while, the next poke is the first again.
    const rested = reduce(reduce(awake(), { type: "poke" }, 2000).brain, { type: "poke" }, 60_000).brain;
    expect(rested.poke?.count).toBe(1);
  });

  it("stops walking when pressed, so a press can become a carry", () => {
    const walking = run(awake(), [{ type: "walking", facing: 1 }]).brain;
    const pressed = reduce(walking, { type: "press" }, 2000);
    expect(pressed.asks).toEqual([{ type: "halt" }]);
    expect(pressed.brain.act.kind).toBe("stand");
    expect(reduce(awake(), { type: "press" }, 2000).asks).toEqual([]);
  });

  it("is carried, dropped, falls and lands", () => {
    const { brain: held, asked } = run(awake(), [{ type: "grab" }]);
    expect(asked).toEqual(["hold"]);
    expect(pose(held)).toMatchObject({ move: "held", still: false });
    expect(held.thinkAt).toBeNull();
    // A poke or a thought means nothing in the hand.
    expect(reduce(held, { type: "poke" }, 2000).brain).toBe(held);
    expect(reduce(held, { type: "think" }, 999_999).brain).toBe(held);

    const let_go = reduce(held, { type: "drop" }, 3000);
    expect(let_go.asks).toEqual([{ type: "release" }]);
    const falling = reduce(let_go.brain, { type: "falling", tossed: false }, 3010).brain;
    expect(pose(falling).move).toBe("fall");
    expect(pose(reduce(let_go.brain, { type: "falling", tossed: true }, 3010).brain).move).toBe("tumble");

    const landed = reduce(falling, { type: "landed", impact: 120, flat: false }, 3600).brain;
    expect(pose(landed)).toMatchObject({ move: "land", loops: 1 });
    expect(pose(reduce(falling, { type: "landed", impact: 900, flat: true }, 3600).brain).move).toBe("splat");
    const up = reduce(landed, { type: "done" }, 4200).brain;
    expect(up.act.kind).toBe("stand");
    expect(up.thinkAt).not.toBeNull();
  });

  it("walks back onto her edge when she lands off the end of it", () => {
    const falling = run(awake(), [{ type: "grab" }, { type: "drop" }, { type: "falling", tossed: false }]).brain;
    const back = run(falling, [
      { type: "landed", impact: 100, flat: false },
      { type: "walking", facing: 1 }
    ]).brain;
    expect(pose(back).move).toBe("walk");
    expect(reduce(back, { type: "arrived" }, 9000).brain.act.kind).toBe("stand");
  });
});

describe("desktop Pip's sign and menu", () => {
  it("holds the sign up standing, and does nothing else while it is up", () => {
    const sat = (() => {
      const brain = awake();
      return reduce(brain, { type: "think" }, brain.thinkAt!, rolls(0.5)).brain;
    })();
    const signed = reduce(sat, { type: "sign", text: "time to read?" }, 20_000).brain;
    expect(pose(signed)).toMatchObject({ move: "holdup", still: true, flip: false });
    expect(signShowing(signed)).toBe(true);
    expect(signed.thinkAt).toBeNull();
    // A poke is left to the page, which follows the sign instead.
    expect(reduce(signed, { type: "poke" }, 21_000).brain).toBe(signed);
    // Put down, she is herself again.
    const after = reduce(signed, { type: "sign", text: null }, 30_000).brain;
    expect(pose(after).move).toBe("idle");
    expect(after.thinkAt).not.toBeNull();
  });

  it("stops a stroll for the sign", () => {
    const walking = run(awake(), [{ type: "walking", facing: 1 }]).brain;
    const step = reduce(walking, { type: "sign", text: "your streak!" }, 2000);
    expect(step.asks).toEqual([{ type: "halt" }]);
    expect(pose(step.brain).move).toBe("holdup");
  });

  it("puts the sign away in the hand and takes it out again on landing", () => {
    const signed = reduce(awake(), { type: "sign", text: "time to read?" }, 2000).brain;
    const held = reduce(signed, { type: "grab" }, 3000).brain;
    expect(signShowing(held)).toBe(false);
    const down = run(held, [{ type: "drop" }, { type: "falling", tossed: false }, { type: "landed", impact: 50, flat: false }, { type: "done" }]).brain;
    expect(signShowing(down)).toBe(true);
    expect(pose(down).move).toBe("holdup");
  });

  it("waits while her menu is open, and carries on when it closes", () => {
    const walking = run(awake(), [{ type: "walking", facing: 1 }]).brain;
    const opened = reduce(walking, { type: "menu", open: true }, 2000);
    expect(opened.asks).toEqual([{ type: "halt" }]);
    expect(opened.brain.act.kind).toBe("stand");
    expect(opened.brain.thinkAt).toBeNull();
    expect(reduce(opened.brain, { type: "think" }, 999_999, rolls(0.1)).asks).toEqual([]);
    const closed = reduce(opened.brain, { type: "menu", open: false }, 6000).brain;
    expect(closed.thinkAt).not.toBeNull();
    // Picked up, the menu shuts.
    expect(reduce(opened.brain, { type: "grab" }, 2500).brain.menu).toBe(false);
  });
});
