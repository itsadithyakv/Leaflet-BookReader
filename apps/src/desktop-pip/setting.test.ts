import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetBooksOnThisDevice } from "../services/deviceData";
import { DESKTOP_PIP_KEYS, ENABLED_KEY, HIDDEN_KEY, dayKey, readChoice, wantedFrom, writeEnabled, writeHiddenOn } from "./setting";

/** The part of `localStorage` the code uses. */
const fakeStorage = (entries: Record<string, string> = {}) => {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    keys: () => Array.from(data.keys()).sort()
  };
};

describe("the reader's choice about Pip on the desktop", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is off until the reader turns it on", () => {
    expect(readChoice(fakeStorage())).toEqual({ enabled: false, hiddenOn: null });
    expect(wantedFrom(readChoice(fakeStorage()), "chatty", "2026-03-03").enabled).toBe(false);
  });

  it("remembers the switch, and forgets it when switched off", () => {
    const store = fakeStorage();
    writeEnabled(true, store);
    expect(readChoice(store).enabled).toBe(true);
    writeEnabled(false, store);
    expect(store.keys()).toEqual([]);
  });

  it("hides her for the day chosen, and no longer", () => {
    const store = fakeStorage({ [ENABLED_KEY]: "1" });
    writeHiddenOn("2026-03-03", store);
    expect(wantedFrom(readChoice(store), "chatty", "2026-03-03").hiddenOn).toBe("2026-03-03");
    expect(wantedFrom(readChoice(store), "chatty", "2026-03-04").hiddenOn).toBeNull();
    writeHiddenOn(null, store);
    expect(readChoice(store).hiddenOn).toBeNull();
    // Something that is not a day is not believed.
    expect(readChoice(fakeStorage({ [HIDDEN_KEY]: "forever" })).hiddenOn).toBeNull();
  });

  it("follows Pip's mode: off everywhere is off out there, quiet is quiet", () => {
    const on = { enabled: true, hiddenOn: null };
    expect(wantedFrom(on, "chatty", "2026-03-03")).toEqual({ enabled: true, hiddenOn: null, pipOff: false, quiet: false });
    expect(wantedFrom(on, "quiet", "2026-03-03")).toMatchObject({ pipOff: false, quiet: true });
    expect(wantedFrom(on, "off", "2026-03-03")).toMatchObject({ pipOff: true });
  });

  it("writes the day the way Rust does", () => {
    expect(dayKey(new Date(2026, 2, 3, 23, 59))).toBe("2026-03-03");
    expect(dayKey(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });

  it("survives storage that cannot be used", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      }
    };
    expect(readChoice(broken)).toEqual({ enabled: false, hiddenOn: null });
    expect(() => writeEnabled(true, broken)).not.toThrow();
    expect(() => writeHiddenOn("2026-03-03", broken)).not.toThrow();
  });

  it("is removed by Delete All Data", () => {
    const store = fakeStorage({ [ENABLED_KEY]: "1", [HIDDEN_KEY]: "2026-03-03", "leaflet.appearance.v1": '{"theme":"dark"}' });
    vi.stubGlobal("localStorage", store);
    forgetBooksOnThisDevice();
    for (const key of DESKTOP_PIP_KEYS) {
      expect(store.getItem(key)).toBeNull();
    }
    expect(store.getItem("leaflet.appearance.v1")).not.toBeNull();
  });
});
