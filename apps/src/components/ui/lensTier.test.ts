import { afterEach, describe, expect, it, vi } from "vitest";

/** A page that can draw an SVG backdrop filter (Chromium), with a <html> to mark. */
const chromiumPage = () => {
  const classes = new Set<string>();
  const dataset: Record<string, string> = {};
  const root = {
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
  };
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36" });
  vi.stubGlobal("document", {
    documentElement: root,
    createElement: () => {
      const props: Record<string, string> = {};
      return { style: { setProperty: (k: string, v: string) => (props[k] = v), getPropertyValue: (k: string) => props[k] ?? "" } };
    },
  });
  return { classes, dataset };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the lens and the visual effects", () => {
  it("is drawn only on Full: Smooth takes `glass-refracts` off and minimal marks `.no-glass`", async () => {
    const page = chromiumPage();
    const tier = await import("../../platform/perfTier");
    const lens = await import("./glassRefraction");
    expect(lens.glassCanRefract()).toBe(true);

    tier.setEffectsChoice("full");
    lens.installGlassRefraction();
    expect(lens.lensDrawn()).toBe(true);
    expect(page.classes.has("glass-refracts")).toBe(true);
    expect(page.dataset.perf).toBe("full");

    tier.setEffectsChoice("lite");
    expect(lens.lensDrawn()).toBe(false);
    expect(page.classes.has("glass-refracts")).toBe(false);
    expect(page.dataset.perf).toBe("lite");
    expect(page.classes.has("no-glass")).toBe(false);

    tier.setEffectsChoice("full");
    expect(page.classes.has("glass-refracts")).toBe(true);
  });

  it("goes when the watchdog steps Auto down, and stays down for the session", async () => {
    const page = chromiumPage();
    const tier = await import("../../platform/perfTier");
    const lens = await import("./glassRefraction");
    tier.setEffectsChoice("auto");
    lens.installGlassRefraction();
    // (Auto starts from the device's tier; here, never judged, Smooth.)
    expect(tier.currentTier()).toBe("lite");
    expect(page.classes.has("glass-refracts")).toBe(false);
    expect(tier.stepDownForSession("test")).toBe(true);
    expect(tier.currentTier()).toBe("minimal");
    expect(page.classes.has("no-glass")).toBe(true);
    expect(tier.stepDownForSession("test")).toBe(false);
  });

  it("is never stepped down from the reader's own choice", async () => {
    chromiumPage();
    const tier = await import("../../platform/perfTier");
    tier.setEffectsChoice("full");
    expect(tier.stepDownForSession("test")).toBe(false);
    expect(tier.currentTier()).toBe("full");
  });
});
