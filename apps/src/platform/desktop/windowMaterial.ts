import { invoke } from "@tauri-apps/api/core";
import { useAppearanceStore } from "../../store/appearanceStore";
import { currentChoice, currentTier, onTier } from "../perfTier";

/**
 * What the window is made of (src-tauri/src/window_material.rs): Windows 11's
 * Mica behind a see-through page, or nothing (Smooth, the default; Windows 10;
 * a phone; a browser), where the page paints its own background. Rust says
 * which before the page's own script runs, as `data-window-material` on <html>;
 * styles/window-material.css draws the app for it.
 *
 * Mica goes with the full visual effects only. Rust makes the window from the
 * reader's choice as it was at launch (kept beside the library, told here as it
 * changes), so a change in Settings reaches the window at the next start; until
 * then a see-through window under Smooth is painted over by the page, opaque.
 */
export type WindowMaterial = "mica" | "none";

declare global {
  interface Window {
    __LEAFLET_WINDOW_MATERIAL__?: string;
  }
}

/** What Rust made the window of. */
export const windowMaterial = (): WindowMaterial =>
  typeof window !== "undefined" && window.__LEAFLET_WINDOW_MATERIAL__ === "mica" ? "mica" : "none";

/** What the page draws for: Mica's see-through page only while the effects are Full. */
export const drawnMaterial = (): WindowMaterial => (windowMaterial() === "mica" && currentTier() === "full" ? "mica" : "none");

/** Marks <html>, and keeps the window's light or dark (Mica's tint, the title bar) with the app's theme. */
export const installWindowMaterial = () => {
  if (typeof document === "undefined") return;
  const mark = () => {
    const material = drawnMaterial();
    if (document.documentElement.dataset.windowMaterial !== material) document.documentElement.dataset.windowMaterial = material;
  };
  mark();
  // Only a desktop window has Rust's script (and a title bar to match).
  if (typeof window.__LEAFLET_WINDOW_MATERIAL__ !== "string") return;
  // The choice, for the window made at the next launch.
  let told: boolean | undefined;
  const tell = () => {
    mark();
    const full = currentChoice() === "full";
    if (full === told) return;
    told = full;
    void invoke("window_material_effects", { full }).catch(() => undefined);
  };
  tell();
  onTier(tell);
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
