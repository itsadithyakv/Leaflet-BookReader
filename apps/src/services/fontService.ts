import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** A font the reader added: the id Rust keeps it under, and what it is called. */
export type CustomFont = { id: string; name: string };

/** The kinds Rust takes (src-tauri/src/fonts.rs, which goes by the file's first bytes, not its name). */
const EXTENSIONS = ["ttf", "otf", "woff", "woff2"];

const reason = (cause: unknown) =>
  typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "That font could not be added.";

/**
 * The reader's own fonts, to read a book in (readers/customFonts.ts has what
 * is made of one). Rust keeps the files, on this device only: they are not in
 * the backup and are not synced. The browser preview has no files to add one
 * from, so it has none.
 */
export const fontService = {
  /** False in the browser preview. */
  available: () => isTauri(),

  async list(): Promise<CustomFont[]> {
    if (!isTauri()) {
      return [];
    }
    return invoke<CustomFont[]>("fonts_list");
  },

  /**
   * Asks the reader for a font file and adds it. Null when none was picked.
   * Throws, in words for the reader, when the file is not a font Leaflet takes.
   */
  async pickAndAdd(): Promise<CustomFont | null> {
    if (!isTauri()) {
      return null;
    }
    const picked = await open({ multiple: false, title: "Add a font", filters: [{ name: "Fonts", extensions: EXTENSIONS }] });
    if (typeof picked !== "string") {
      return null;
    }
    try {
      return await invoke<CustomFont>("font_add", { path: picked });
    } catch (cause) {
      throw new Error(reason(cause));
    }
  },

  /**
   * The font's file as a data URL, for an `@font-face`. Null when it is not
   * there or could not be read: the page keeps the face it has. Not kept
   * here: a font can be megabytes, and whoever asks holds it while it shows.
   */
  async data(id: string): Promise<string | null> {
    if (!isTauri()) {
      return null;
    }
    try {
      return await invoke<string | null>("font_data", { id });
    } catch {
      return null;
    }
  },

  async remove(id: string): Promise<void> {
    if (isTauri()) {
      await invoke("font_remove", { id });
    }
  }
};
