import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipMode } from "../store/pipStore";
import { ENABLED_KEY, HIDDEN_KEY, dayKey, type Wanted } from "./setting";
import { UNSUPPORTED, canRecall, createDesktopPip, settingLine, type DesktopPipStatus, type Reach } from "./sync";

const fakeStorage = (entries: Record<string, string> = {}) => {
  const data = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    has: (key: string) => data.has(key)
  };
};

/** Rust, as far as Settings can tell: it answers with what it was told. */
const fakeRust = (available = true) => {
  const told: Array<{ wanted: Wanted; recall: boolean }> = [];
  let sentHome = false;
  const answer = (wanted: Wanted): DesktopPipStatus => ({
    supported: true,
    enabled: wanted.enabled,
    out: wanted.enabled && !wanted.pipOff && !sentHome && wanted.hiddenOn === null,
    hiddenToday: wanted.hiddenOn !== null,
    sentHome
  });
  const reach: Reach = {
    available: () => available,
    async set(wanted, recall) {
      told.push({ wanted, recall });
      if (recall) sentHome = false;
      return answer(wanted);
    },
    status: async () => answer(told[told.length - 1]?.wanted ?? { enabled: false, hiddenOn: null, pipOff: false, quiet: false })
  };
  return { reach, told, sendHome: () => (sentHome = true) };
};

describe("the main window keeping Rust told", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("tells Rust nothing in a build that did not ask for her", async () => {
    const calls: string[] = [];
    vi.stubGlobal("localStorage", fakeStorage({ [ENABLED_KEY]: "1" }));
    vi.stubGlobal("isTauri", true);
    vi.stubGlobal("window", {
      addEventListener: () => undefined,
      __TAURI_INTERNALS__: { invoke: async (command: string) => (calls.push(command), { supported: true, enabled: true, out: true, hiddenToday: false, sentHome: false }) }
    });
    // The release switch is read when the module loads.
    vi.resetModules();
    const { desktopPip, startDesktopPip } = await import("./sync");
    startDesktopPip();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]);
    expect(desktopPip.get().supported).toBe(false);
  });

  it("reports at launch, when Pip's mode changes, and when her own window changes the choice", async () => {
    const store = fakeStorage({ [ENABLED_KEY]: "1" });
    const calls: Array<{ command: string; args: { wanted?: Wanted; recall?: boolean } }> = [];
    const listeners: Record<string, (event: { key: string | null }) => void> = {};
    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("isTauri", true);
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: { key: string | null }) => void) => (listeners[type] = listener),
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: { wanted?: Wanted; recall?: boolean }) => {
          calls.push({ command, args });
          return { supported: true, enabled: true, out: true, hiddenToday: false, sentHome: false };
        }
      }
    });
    vi.stubEnv("VITE_ENABLE_DESKTOP_PIP", "true");
    vi.resetModules();
    const { usePipStore } = await import("../store/pipStore");
    const { desktopPip, startDesktopPip } = await import("./sync");
    usePipStore.setState({ mode: "chatty" });

    startDesktopPip();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ command: "desktop_pip_set", args: { wanted: { enabled: true, hiddenOn: null, pipOff: false, quiet: false }, recall: false } });
    await vi.waitFor(() => expect(desktopPip.get().out).toBe(true));
    // A second start (a remount in development) reports nothing more.
    startDesktopPip();

    usePipStore.setState({ mode: "quiet" });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].args.wanted).toMatchObject({ quiet: true, pipOff: false });
    usePipStore.setState({ mode: "off" });
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].args.wanted).toMatchObject({ pipOff: true });

    // "Hide for today", written by her own window.
    listeners.storage({ key: HIDDEN_KEY });
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    expect(calls[3].command).toBe("desktop_pip_status");
    // Someone else's key is none of her business.
    listeners.storage({ key: "leaflet.appearance.v1" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(4);
  });
});

describe("Pip on the desktop, from Settings", () => {
  let store: ReturnType<typeof fakeStorage>;
  let mode: PipMode;

  beforeEach(() => {
    store = fakeStorage();
    mode = "chatty";
    vi.stubGlobal("localStorage", store);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reports off at launch until the reader has switched her on", async () => {
    const rust = fakeRust();
    const pip = createDesktopPip(rust.reach, () => mode);
    await pip.report();
    expect(rust.told).toEqual([{ wanted: { enabled: false, hiddenOn: null, pipOff: false, quiet: false }, recall: false }]);
    expect(pip.get()).toMatchObject({ supported: true, enabled: false, out: false });
  });

  it("switches her on, remembers it, and tells whoever is watching", async () => {
    const rust = fakeRust();
    const pip = createDesktopPip(rust.reach, () => mode);
    const seen: boolean[] = [];
    pip.subscribe(() => seen.push(pip.get().enabled));
    await pip.setEnabled(true);
    expect(store.getItem(ENABLED_KEY)).toBe("1");
    expect(rust.told[0]).toMatchObject({ wanted: { enabled: true }, recall: true });
    expect(pip.get().out).toBe(true);
    expect(seen[0]).toBe(true);
    // The next launch reads the same choice.
    const next = fakeRust();
    await createDesktopPip(next.reach, () => mode).report();
    expect(next.told[0].wanted.enabled).toBe(true);

    await pip.setEnabled(false);
    expect(store.has(ENABLED_KEY)).toBe(false);
    expect(pip.get()).toMatchObject({ enabled: false, out: false });
  });

  it("passes on a day she was hidden for, and calling her back clears it", async () => {
    store.setItem(ENABLED_KEY, "1");
    store.setItem(HIDDEN_KEY, dayKey());
    const rust = fakeRust();
    const pip = createDesktopPip(rust.reach, () => mode);
    await pip.report();
    expect(rust.told[0].wanted.hiddenOn).toBe(dayKey());
    expect(pip.get()).toMatchObject({ enabled: true, out: false, hiddenToday: true });
    expect(canRecall(pip.get(), mode)).toBe(true);

    await pip.recall();
    expect(store.has(HIDDEN_KEY)).toBe(false);
    expect(rust.told[1]).toMatchObject({ wanted: { hiddenOn: null }, recall: true });
    expect(pip.get().out).toBe(true);
  });

  it("calls her back from home", async () => {
    store.setItem(ENABLED_KEY, "1");
    const rust = fakeRust();
    const pip = createDesktopPip(rust.reach, () => mode);
    await pip.report();
    rust.sendHome();
    await pip.refresh();
    expect(pip.get()).toMatchObject({ sentHome: true, out: false });
    expect(settingLine(pip.get(), mode)).toMatch(/home/);
    await pip.recall();
    expect(pip.get()).toMatchObject({ sentHome: false, out: true });
  });

  it("follows Pip's mode", async () => {
    store.setItem(ENABLED_KEY, "1");
    const rust = fakeRust();
    const pip = createDesktopPip(rust.reach, () => mode);
    mode = "off";
    await pip.report();
    expect(rust.told[0].wanted).toMatchObject({ pipOff: true });
    expect(pip.get().out).toBe(false);
    expect(settingLine(pip.get(), mode)).toMatch(/Pip is off/);
    expect(canRecall(pip.get(), mode)).toBe(false);
    mode = "quiet";
    await pip.report();
    expect(rust.told[1].wanted).toMatchObject({ pipOff: false, quiet: true });
  });

  it("says in one line what the switch does", () => {
    const off: DesktopPipStatus = { supported: true, enabled: false, out: false, hiddenToday: false, sentHome: false };
    expect(settingLine(off, "chatty")).toMatch(/taskbar/);
    expect(settingLine({ ...off, enabled: true, hiddenToday: true }, "chatty")).toMatch(/tomorrow/);
  });

  it("offers nothing outside the app, or when Rust does not answer", async () => {
    const browser = fakeRust(false);
    const pip = createDesktopPip(browser.reach, () => mode);
    await pip.report();
    await pip.refresh();
    expect(browser.told).toEqual([]);
    expect(pip.get()).toEqual(UNSUPPORTED);

    const broken: Reach = {
      available: () => true,
      set: () => Promise.reject(new Error("no such command")),
      status: () => Promise.reject(new Error("no such command"))
    };
    const failing = createDesktopPip(broken, () => mode);
    await failing.report();
    expect(failing.get().supported).toBe(false);
  });
});
