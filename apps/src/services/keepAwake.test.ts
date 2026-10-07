import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...(args as [])), isTauri: () => true }));

describe("keeping the screen on", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockClear();
  });

  it("asks once for each change, and not again for the same thing", async () => {
    const { keepAwake } = await import("./keepAwake");
    keepAwake(false);
    expect(invoke).not.toHaveBeenCalled();
    keepAwake(true);
    keepAwake(true);
    expect(invoke.mock.calls).toEqual([["keep_awake", { on: true }]]);
    keepAwake(false);
    keepAwake(false);
    expect(invoke.mock.calls).toEqual([["keep_awake", { on: true }], ["keep_awake", { on: false }]]);
  });

  it("is not stopped by a backend that refuses", async () => {
    invoke.mockImplementationOnce(() => Promise.reject(new Error("no such command")));
    const { keepAwake } = await import("./keepAwake");
    expect(() => keepAwake(true)).not.toThrow();
    await Promise.resolve();
    keepAwake(false);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
