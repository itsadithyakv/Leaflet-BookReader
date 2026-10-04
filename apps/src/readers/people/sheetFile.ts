import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * A character sheet as a file on the reader's own disk: saved where they
 * choose, and picked by them to bring one in. Nothing is sent anywhere.
 */

/** A sheet file larger than this is not one (a long book's is a few hundred kilobytes). */
const MAX_BYTES = 8 * 1024 * 1024;

/** A file name the reader can recognise, safe on every system. */
export const sheetFileName = (title: string) =>
  `${
    title
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "Book"
  } - characters.json`;

/** Saves the sheet where the reader chooses. False when they chose nowhere. */
export const saveSheetFile = async (name: string, contents: string): Promise<boolean> => {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name, filters: [{ name: "Leaflet characters", extensions: ["json"] }] });
    if (!path) {
      return false;
    }
    await invoke("people_export", { path, contents });
    return true;
  }
  // The browser preview: a download.
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
};

/** The contents of a sheet file the reader picks; null when they picked none. */
export const pickSheetFile = (): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    let settled = false;
    const done = (value: string | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    input.addEventListener("cancel", () => done(null));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        done(null);
        return;
      }
      if (file.size > MAX_BYTES) {
        settled = true;
        reject(new Error("That file is too large to be a character sheet."));
        return;
      }
      file.text().then(done, () => {
        settled = true;
        reject(new Error("That file could not be read."));
      });
    });
    input.click();
  });
