import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

type Root = { dataset: Record<string, string>; style: Record<string, string> };

/** Just enough of a page: <html> with its dataset, and a window that may carry Rust's word. */
const page = (material?: string) => {
  const root: Root & { classList: unknown } = { dataset: {}, style: {}, classList: { toggle: () => false, contains: () => false } };
  const win: Record<string, unknown> = {};
  if (material !== undefined) win.__LEAFLET_WINDOW_MATERIAL__ = material;
  vi.stubGlobal("document", { documentElement: root, querySelector: () => null });
  vi.stubGlobal("window", win);
  return root;
};

const load = async (effects: "auto" | "full" | "lite" = "full") => {
  vi.resetModules();
  const tier = await import("../perfTier");
  tier.setEffectsChoice(effects);
  const store = await import("../../store/appearanceStore");
  const material = await import("./windowMaterial");
  return { ...store, ...material, ...tier };
};

describe("the window's material, on the page", () => {
  beforeEach(() => invoke.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it("is none where Rust said nothing (a browser, a phone)", async () => {
    const root = page();
    const { installWindowMaterial, windowMaterial } = await load();
    installWindowMaterial();
    expect(windowMaterial()).toBe("none");
    expect(root.dataset.windowMaterial).toBe("none");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("is mica where Rust said so, and the window takes the app's theme", async () => {
    const root = page("mica");
    const { installWindowMaterial, useAppearanceStore } = await load();
    installWindowMaterial();
    expect(root.dataset.windowMaterial).toBe("mica");
    expect(invoke).toHaveBeenLastCalledWith("window_material_theme", { theme: "light" });

    useAppearanceStore.getState().setTheme("dark");
    expect(invoke).toHaveBeenLastCalledWith("window_material_theme", { theme: "dark" });
  });

  it("is none on a Mica window under Smooth (the page paints itself opaque), and Rust keeps the choice for the next launch", async () => {
    const root = page("mica");
    const { installWindowMaterial, setEffectsChoice } = await load("auto");
    installWindowMaterial();
    expect(root.dataset.windowMaterial).toBe("none");
    expect(invoke).toHaveBeenCalledWith("window_material_effects", { full: false });

    setEffectsChoice("full");
    expect(root.dataset.windowMaterial).toBe("mica");
    expect(invoke).toHaveBeenLastCalledWith("window_material_effects", { full: true });

    setEffectsChoice("lite");
    expect(root.dataset.windowMaterial).toBe("none");
    expect(invoke).toHaveBeenLastCalledWith("window_material_effects", { full: false });
  });

  it("stays none on an opaque window when Full is chosen (Mica comes at the next launch)", async () => {
    const root = page("none");
    const { installWindowMaterial, setEffectsChoice } = await load("auto");
    installWindowMaterial();
    setEffectsChoice("full");
    expect(root.dataset.windowMaterial).toBe("none");
    expect(invoke).toHaveBeenLastCalledWith("window_material_effects", { full: true });
  });

  it("follows Windows when the reader follows Windows (no theme forced on the window)", async () => {
    page("mica");
    const { installWindowMaterial, useAppearanceStore } = await load();
    installWindowMaterial();
    useAppearanceStore.getState().followSystemTheme();
    expect(invoke).toHaveBeenLastCalledWith("window_material_theme", { theme: null });
  });

  it("tells the window only when its theme changes", async () => {
    page("none");
    const { installWindowMaterial, useAppearanceStore } = await load();
    installWindowMaterial();
    const calls = invoke.mock.calls.length;
    // A store change that leaves the theme where it was.
    useAppearanceStore.setState({ theme: "light" });
    expect(invoke.mock.calls.length).toBe(calls);
  });
});
