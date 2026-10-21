import { invoke } from "@tauri-apps/api/core";
import { useAppearanceStore } from "../../store/appearanceStore";

/**
 * What the window is made of (src-tauri/src/window_material.rs): Windows 11's
 * Mica behind a see-through page, or nothing (Windows 10, a phone, a browser),
 * where the page paints its own background. Rust says which before the page's
 * own script runs, as `data-window-material` on <html>; styles/window-material.css
 * draws the app for it.
 */
export type WindowMaterial = "mica" | "none";

declare global {
  interface Window {
    __LEAFLET_WINDOW_MATERIAL__?: string;
  }
}

export const windowMaterial = (): WindowMaterial =>
  typeof window !== "undefined" && window.__LEAFLET_WINDOW_MATERIAL__ === "mica" ? "mica" : "none";

/** Marks <html>, and keeps the window's light or dark (Mica's tint, the title bar) with the app's theme. */
export const installWindowMaterial = () => {
  if (typeof document === "undefined") return;
  const material = windowMaterial();
  document.documentElement.dataset.windowMaterial = material;
  // Only a desktop window has Rust's script (and a title bar to match).
  if (typeof window.__LEAFLET_WINDOW_MATERIAL__ !== "string") return;
  let last: string | null | undefined;
  const sync = () => {
    const { theme, followSystem } = useAppearanceStore.getState();
    // Following Windows: the window follows it too, so the page's own
    // `prefers-color-scheme` keeps telling the system's choice.
    const wanted = followSystem ? null : theme;
    if (wanted === last) return;
    last = wanted;
    void invoke("window_material_theme", { theme: wanted }).catch(() => undefined);
  };
  sync();
  useAppearanceStore.subscribe(sync);
};
