import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOOK, lookOf, tauriHost, type HostEvent } from "./host";

/**
 * Tauri's side of the bridge, as far as the page's calls go: `invoke`, and
 * the callback registry a Channel puts itself in. Rust delivers a channel
 * message by calling that callback with `{ message, index }`.
 */
const fakeTauri = (answers: Record<string, unknown> = {}) => {
  const callbacks = new Map<number, (raw: unknown) => void>();
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  const internals = {
    transformCallback: (callback: (raw: unknown) => void) => {
      const id = callbacks.size + 1;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => void callbacks.delete(id),
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });
      if (answers[command] instanceof Error) throw answers[command];
      return answers[command];
    }
  };
  return { internals, calls, deliver: (id: number, message: HostEvent, index: number) => callbacks.get(id)?.({ message, index }) };
};

describe("desktop Pip's page talking to Rust", () => {
  let tauri: ReturnType<typeof fakeTauri>;
  const use = (answers: Record<string, unknown> = {}) => {
    tauri = fakeTauri(answers);
    vi.stubGlobal("window", { __TAURI_INTERNALS__: tauri.internals });
  };

  beforeEach(() => use());
  afterEach(() => vi.unstubAllGlobals());

  it("hands over a channel when it is ready, and hears her events down it in order", async () => {
    use({ desktop_pip_attach: { night: false, quiet: true, facing: -1, sign: null } });
    const heard: HostEvent[] = [];
    const snapshot = await tauriHost().attach(true, (event) => heard.push(event));
    expect(snapshot).toEqual({ night: false, quiet: true, facing: -1, sign: null });

    const call = tauri.calls[0];
    expect(call.command).toBe("desktop_pip_attach");
    expect(call.args.still).toBe(true);
    // The channel travels as its id, which is how Rust finds the callback.
    const sent = JSON.parse(JSON.stringify(call.args.channel)) as string;
    expect(sent).toMatch(/^__CHANNEL__:\d+$/);
    const id = Number(sent.split(":")[1]);

    tauri.deliver(id, { type: "walking", facing: 1 }, 0);
    // Out of order: held back until the one before it has come.
    tauri.deliver(id, { type: "landed", impact: 300, flat: false }, 2);
    tauri.deliver(id, { type: "arrived" }, 1);
    expect(heard.map((event) => event.type)).toEqual(["walking", "arrived", "landed"]);
  });

  it("says there is no Pip to draw when Rust has none", async () => {
    use({ desktop_pip_attach: null });
    expect(await tauriHost().attach(false, () => undefined)).toBeNull();
  });

  it("names its commands and arguments the way Rust declares them", async () => {
    use({ desktop_pip_stroll: 1, desktop_pip_hold: true });
    const host = tauriHost();
    expect(await host.stroll(0.4, true)).toBe(1);
    expect(await host.hold()).toBe(true);
    host.halt();
    host.release();
    host.frame({ width: 64, height: 48 });
    host.act("today");
    host.act("continue");
    expect(tauri.calls).toEqual([
      { command: "desktop_pip_stroll", args: { roll: 0.4, turn: true } },
      { command: "desktop_pip_hold", args: {} },
      { command: "desktop_pip_halt", args: {} },
      { command: "desktop_pip_release", args: {} },
      { command: "desktop_pip_frame", args: { width: 64, height: 48 } },
      { command: "desktop_pip_act", args: { action: "today" } },
      { command: "desktop_pip_act", args: { action: "continue" } }
    ]);
  });

  it("carries on when a call fails: she just does not do the thing", async () => {
    use({ desktop_pip_hold: new Error("gone"), pip_state_get: new Error("gone") });
    const host = tauriHost();
    expect(await host.hold()).toBe(false);
    expect(await host.look()).toEqual(DEFAULT_LOOK);
    expect(() => host.release()).not.toThrow();
  });

  it("wears what the reader equipped on the Pip tab", async () => {
    use({ pip_state_get: { state: { variant: "ember", outfit: ["cap", "scarf"], mood: 70 } } });
    expect(await tauriHost().look()).toEqual({ skin: "ember", outfit: ["cap", "scarf"] });
    expect(lookOf(null)).toEqual(DEFAULT_LOOK);
    expect(lookOf({ state: { variant: 7, outfit: "cap" } })).toEqual(DEFAULT_LOOK);
  });
});
