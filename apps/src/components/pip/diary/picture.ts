import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * A postcard as a picture on the reader's own disk or clipboard. Nothing is
 * sent anywhere: sharing it is the reader's to do, with whatever they share
 * pictures with.
 */

/** A file name the reader can recognise, safe on every system. */
export const pictureFileName = (weekStart: string) => `Pip's week ${weekStart.replace(/[^0-9-]/g, "")}.png`.replace(/'/g, "");

const PNG_PREFIX = "data:image/png;base64,";

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, "image/png");
    } catch {
      resolve(null);
    }
  });

/**
 * Saves the canvas as a PNG where the reader chooses: a save dialog in the
 * app (the file is written by `diary_save_picture`, which takes only a .png
 * that is one), a download in the browser preview. False when they chose
 * nowhere.
 */
export const savePicture = async (name: string, canvas: HTMLCanvasElement): Promise<boolean> => {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name, filters: [{ name: "Picture", extensions: ["png"] }] });
    if (!path) {
      return false;
    }
    const url = canvas.toDataURL("image/png");
    if (!url.startsWith(PNG_PREFIX)) {
      throw new Error("The picture couldn't be made.");
    }
    await invoke("diary_save_picture", { path, png: url.slice(PNG_PREFIX.length) });
    return true;
  }
  const blob = await toBlob(canvas);
  if (!blob) {
    throw new Error("The picture couldn't be made.");
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
};

/**
 * Copies the card: the picture where the clipboard takes pictures, its words
 * where it takes only text. Says which went, or "none".
 */
export const copyPicture = async (canvas: HTMLCanvasElement, words: string): Promise<"picture" | "words" | "none"> => {
  try {
    const blob = await toBlob(canvas);
    if (blob && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "picture";
    }
  } catch {
    // No picture clipboard here (or no leave to use it): the words, then.
  }
  try {
    await navigator.clipboard.writeText(words);
    return "words";
  } catch {
    return "none";
  }
};
