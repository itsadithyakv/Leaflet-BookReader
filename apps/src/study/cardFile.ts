import { invoke, isTauri } from "@tauri-apps/api/core";
import { android, onAndroid } from "../platform/android";

/**
 * A book's cards as a CSV file on the reader's own disk (study/export.ts
 * writes it): saved where they choose, or on a phone handed to the share
 * sheet (Save to Files, Drive, a message). Nothing is sent anywhere else.
 * False when they chose nowhere.
 */
export const saveCardsFile = async (name: string, contents: string): Promise<boolean> => {
  if (onAndroid()) {
    const path = await android.shareTarget(name);
    if (!path) {
      throw new Error("The cards couldn't be saved.");
    }
    await invoke("cards_export", { path, contents });
    await android.shareFile(path, "text/csv", name);
    return true;
  }
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name, filters: [{ name: "Cards (CSV)", extensions: ["csv"] }] });
    if (!path) {
      return false;
    }
    await invoke("cards_export", { path, contents });
    return true;
  }
  // The browser preview: a download.
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
};
