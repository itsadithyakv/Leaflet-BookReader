/** The reading surface: page colours for each display mode and theme. */

import type { ThemeMode } from "../store/appearanceStore";
import { PAPER_GRAIN } from "../constants/textures";
import type { ReaderDisplayMode } from "./readerTypes";

export const getReaderFinish = (displayMode: ReaderDisplayMode, theme: ThemeMode) => {
  if (displayMode === "paper") {
    return {
      themeName: "leaflet-light",
      background: "#f0eadc",
      text: "#30291f",
      texture: PAPER_GRAIN,
      textureOpacity: "e0"
    };
  }
  if (displayMode === "dark-paper") {
    return {
      themeName: "leaflet-dark",
      background: "#191b1a",
      text: "#eeeae0",
      texture: PAPER_GRAIN,
      textureOpacity: "d4"
    };
  }
  if (displayMode === "true-white") {
    return {
      themeName: "leaflet-light",
      background: "#f8f8f4",
      text: "#090a09",
      texture: null,
      textureOpacity: "ff"
    };
  }
  if (displayMode === "true-black") {
    return {
      themeName: "leaflet-dark",
      background: "#000000",
      text: "#f2f1eb",
      texture: null,
      textureOpacity: "ff"
    };
  }
  return theme === "light"
    ? {
        themeName: "leaflet-light",
        background: "#edeae2",
        text: "#16191e",
        texture: PAPER_GRAIN,
        textureOpacity: "e8"
      }
    : {
        themeName: "leaflet-dark",
        background: "#202227",
        text: "#f7f9fc",
        texture: PAPER_GRAIN,
        textureOpacity: "e8"
      };
};

export const getReaderFinishBackground = (finish: ReturnType<typeof getReaderFinish>) =>
  finish.texture
    ? `linear-gradient(${finish.background}${finish.textureOpacity}, ${finish.background}${finish.textureOpacity}), ${finish.texture}`
    : "none";

/** The book's text starts this far down, below the floating toolbar. */
export const PAGE_TOP_PAD = 80;
