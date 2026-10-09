import { open } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IMPORTABLE_EXTENSIONS,
  setSupportedFormats,
  type BookFormat
} from "../../constants/bookFormats";

/**
 * Ask the backend which formats it accepts so the dialog can never offer a file
 * that import would then silently drop.
 */
async function dialogExtensions(): Promise<string[]> {
  if (!isTauri()) {
    return IMPORTABLE_EXTENSIONS;
  }
  try {
    const formats = await invoke<BookFormat[]>("supported_formats");
    if (formats.length > 0) {
      setSupportedFormats(formats);
      return formats.map((format) => format.extension);
    }
  } catch {
    // Fall back to the bundled mirror.
  }
  return IMPORTABLE_EXTENSIONS;
}

/**
 * Picks the directory that carries sync.
 *
 * Readers point this at a folder their Drive, Dropbox or OneDrive client
 * already keeps in step, which gives cross-device sync with no account and no
 * API at all.
 */
export async function pickSyncFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

/** Picks the folder that holds a readable copy of each book. */
export async function pickLibraryCopyFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose a folder for copies of your books"
  });
  return typeof selected === "string" ? selected : null;
}

/** Picks the folder whose book files are to be renamed and sorted. */
export async function pickTidyFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose the folder your book files are in"
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickBookFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    filters: [
      { name: "Books", extensions: await dialogExtensions() }
    ]
  });

  if (!selected) {
    return [];
  }

  if (Array.isArray(selected)) {
    return selected;
  }

  return [];
}
