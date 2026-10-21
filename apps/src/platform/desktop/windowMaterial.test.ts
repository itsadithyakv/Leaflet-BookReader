import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

type Root = { dataset: Record<string, string>; style: Record<string, string> };

/** Just enough of a page: <html> with its dataset, and a window that may carry Rust's word. */
const page = (material?: string) => {
  const root: Root = { dataset: {}, style: {} };
  const win: Record<string, unknown> = {};
  if (material !== undefined) win.__LEAFLET_WINDOW_MATERIAL__ = material;
  vi.stubGlobal("document", { documentElement: root, querySelector: () => null });
  vi.stubGlobal("window", win);
  return root;
};

const load = async () => {
  vi.resetModules();
  const store = await import("../../store/appearanceStore");
  const material = await import("./windowMaterial");
  return { ...store, ...material };
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
