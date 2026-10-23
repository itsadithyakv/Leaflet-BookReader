import { afterEach, describe, expect, it, vi } from "vitest";
import { afterStartup, resetStartupForTests, settleStartup, startupSettled } from "./afterStartup";

afterEach(() => resetStartupForTests(true));

describe("afterStartup", () => {
  it("runs at once when the start is over (and in the tests, which have no page)", () => {
    resetStartupForTests(true);
    const run = vi.fn();
    afterStartup(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits for the start to settle, then runs each once, in order", () => {
    resetStartupForTests(false);
    const order: string[] = [];
    afterStartup(() => order.push("pip"));
    afterStartup(() => order.push("lookups"));
    expect(order).toEqual([]);
    expect(startupSettled()).toBe(false);
    settleStartup();
    expect(order).toEqual(["pip", "lookups"]);
    settleStartup();
    expect(order).toEqual(["pip", "lookups"]);
    expect(startupSettled()).toBe(true);
  });

  it("does not run what was cancelled while waiting", () => {
    resetStartupForTests(false);
    const kept = vi.fn();
    const dropped = vi.fn();
    afterStartup(kept);
    const cancel = afterStartup(dropped);
    cancel();
    settleStartup();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });

  it("keeps going when one of them throws", () => {
    resetStartupForTests(false);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const after = vi.fn();
    afterStartup(() => {
      throw new Error("lookup failed");
    });
    afterStartup(after);
    settleStartup();
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
