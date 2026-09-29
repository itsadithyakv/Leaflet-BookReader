import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRACE_MS, QUICK_BUY_UNDER, createGrace, isQuickBuy, type GraceItem } from "./quickBuy";

type Item = GraceItem & { name: string };

const item = (name: string, log: string[], fail = false): Item => ({
  name,
  commit: async () => {
    log.push(`commit ${name}`);
    if (fail) throw new Error(`no ${name}`);
  },
  revert: () => log.push(`revert ${name}`)
});

/** Lets queued promise callbacks run (fake timers leave promises alone). */
const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

describe("which purchases ask first", () => {
  it("buys cheap things at once and asks about dear ones", () => {
    expect(isQuickBuy(1)).toBe(true);
    expect(isQuickBuy(QUICK_BUY_UNDER - 1)).toBe(true);
    expect(isQuickBuy(QUICK_BUY_UNDER)).toBe(false);
    expect(isQuickBuy(450)).toBe(false);
    // Free things are not purchases at all.
    expect(isQuickBuy(0)).toBe(false);
  });
});

describe("the grace period before a quick purchase is made", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes the purchase once the toast's time is up, and not before", async () => {
    const log: string[] = [];
    const shown: Array<string | null> = [];
    const grace = createGrace<Item>({ onChange: (pending) => shown.push(pending?.name ?? null) });
    grace.start(item("cookie", log));
    expect(shown).toEqual(["cookie"]);
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
    expect(log).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toEqual(["commit cookie"]);
    expect(shown).toEqual(["cookie", null]);
    expect(grace.current()).toBeNull();
  });

  it("takes it back on undo: nothing is bought, and the page is put back", async () => {
    const log: string[] = [];
    const grace = createGrace<Item>();
    const id = grace.start(item("hat", log));
    await vi.advanceTimersByTimeAsync(GRACE_MS / 2);
    expect(grace.undo(id)).toBe(true);
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(log).toEqual(["revert hat"]);
  });

  it("cannot undo once the time is up", async () => {
    const log: string[] = [];
    const grace = createGrace<Item>();
    const id = grace.start(item("radish", log));
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    expect(grace.undo(id)).toBe(false);
    expect(log).toEqual(["commit radish"]);
  });

  it("makes the waiting purchase at once when another starts, and undo reaches only the new one", async () => {
    const log: string[] = [];
    const grace = createGrace<Item>();
    const first = grace.start(item("cookie", log));
    await vi.advanceTimersByTimeAsync(1000);
    grace.start(item("tea", log));
    await settle();
    expect(log).toEqual(["commit cookie"]);
    expect(grace.undo(first)).toBe(false);
    expect(grace.undo()).toBe(true);
    expect(log).toEqual(["commit cookie", "revert tea"]);
  });

  it("gives the newest purchase its own full time", async () => {
    const log: string[] = [];
    const grace = createGrace<Item>();
    grace.start(item("cookie", log));
    await vi.advanceTimersByTimeAsync(GRACE_MS - 100);
    grace.start(item("tea", log));
    await vi.advanceTimersByTimeAsync(GRACE_MS - 100);
    expect(log).toEqual(["commit cookie"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(log).toEqual(["commit cookie", "commit tea"]);
  });

  it("flushes on leaving, so a purchase not taken back is still made", async () => {
    const log: string[] = [];
    const grace = createGrace<Item>();
    grace.start(item("duck", log));
    await grace.flush();
    expect(log).toEqual(["commit duck"]);
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(log).toEqual(["commit duck"]);
  });

  it("puts the page back and says why when the purchase is refused", async () => {
    const log: string[] = [];
    const errors: string[] = [];
    const grace = createGrace<Item>({ onError: (cause) => errors.push((cause as Error).message) });
    grace.start(item("cake", log, true));
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    expect(log).toEqual(["commit cake", "revert cake"]);
    expect(errors).toEqual(["no cake"]);
  });

  it("makes purchases one after another, in the order they were spent", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const slow: Item = {
      name: "slow",
      commit: () =>
        new Promise<void>((resolve) => {
          order.push("slow starts");
          release = () => {
            order.push("slow ends");
            resolve();
          };
        }),
      revert: () => undefined
    };
    const grace = createGrace<Item>();
    grace.start(slow);
    grace.start(item("fast", order));
    await settle();
    const done = grace.flush();
    await settle();
    expect(order).toEqual(["slow starts"]);
    release();
    await done;
    expect(order).toEqual(["slow starts", "slow ends", "commit fast"]);
  });
});
