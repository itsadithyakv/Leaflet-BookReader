import { afterEach, describe, expect, it, vi } from "vitest";

/** A page with a <html> to mark and a localStorage, on a computer or a phone. */
const page = (userAgent: string, stored: Record<string, string> = {}) => {
  const classes = new Set<string>();
  const dataset: Record<string, string> = {};
  const store = new Map(Object.entries(stored));
  vi.stubGlobal("navigator", { userAgent, deviceMemory: 8, hardwareConcurrency: 12 });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  vi.stubGlobal("document", {
    documentElement: {
      dataset,
      classList: {
        toggle: (name: string, on?: boolean) => {
          const next = on ?? !classes.has(name);
          if (next) classes.add(name);
          else classes.delete(name);
          return next;
        },
        contains: (name: string) => classes.has(name),
      },
    },
    // No WebGL here: a desktop must not ask for it at all.
    createElement: () => {
      throw new Error("no WebGL context on the desktop");
    },
  });
  vi.stubGlobal("window", {});
  return { dataset, classes, store };
};

const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; CPH2619) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the visual effects at start", () => {
  it("are Smooth on the Windows app on Auto, drawn as the leather desktop, with no WebGL context opened", async () => {
    const { dataset, classes } = page(WINDOWS);
    const tier = await import("./perfTier");
    tier.installPerfTier();
    expect(tier.currentChoice()).toBe("auto");
    expect(tier.currentTier()).toBe("lite");
    expect(dataset.perf).toBe("lite");
    expect(dataset.look).toBe("leather");
    expect(classes.has("no-glass")).toBe(false);
  });

  it("move a desktop judged Full under the old rules (1.5.10) to the new default", async () => {
    const kept = JSON.stringify({ v: 2, tier: "full", renderer: "ANGLE (Intel, Intel(R) UHD Graphics)", memory: 8, cores: 12, android: false });
    const { dataset, store } = page(WINDOWS, { "leaflet.perf.auto.v1": kept });
    const tier = await import("./perfTier");
    tier.installPerfTier();
    expect(tier.currentTier()).toBe("lite");
    expect(dataset.look).toBe("leather");
    expect(JSON.parse(store.get("leaflet.perf.auto.v1")!)).toMatchObject({ v: tier.RULES_VERSION, tier: "lite" });
  });

  it("keep Full for a reader who chose it, drawn as glass", async () => {
    const { dataset } = page(WINDOWS, { "leaflet.effects.v1": "full" });
    const tier = await import("./perfTier");
    tier.installPerfTier();
    expect(tier.currentChoice()).toBe("full");
    expect(tier.currentTier()).toBe("full");
    expect(dataset.look).toBe("glass");
  });

  it("switch the desktop's look with the choice in Settings", async () => {
    const { dataset, store } = page(WINDOWS);
    const tier = await import("./perfTier");
    tier.installPerfTier();
    tier.setEffectsChoice("full");
    expect(dataset.perf).toBe("full");
    expect(dataset.look).toBe("glass");
    expect(store.get("leaflet.effects.v1")).toBe("full");
    tier.setEffectsChoice("auto");
    expect(dataset.perf).toBe("lite");
    expect(dataset.look).toBe("leather");
    expect(store.has("leaflet.effects.v1")).toBe(false);
  });

  it("keep a phone's glass shapes on Smooth", async () => {
    const kept = JSON.stringify({ v: 3, tier: "lite", renderer: "Adreno (TM) 619", memory: 8, cores: 12, android: true });
    const { dataset } = page(ANDROID, { "leaflet.perf.auto.v1": kept });
    const tier = await import("./perfTier");
    tier.installPerfTier();
    expect(dataset.perf).toBe("lite");
    expect(dataset.look).toBe("glass");
  });
});
