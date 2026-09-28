import { open } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { IMPORTABLE_EXTENSIONS, setSupportedFormats, type BookFormat } from "../../constants/bookFormats";

/**
 * Ask the backend which formats it accepts so the picker can never offer a file
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
 * Picks books on a phone or tablet.
 *
 * This used to `invoke("pick_books")`, a command that does not exist in the
 * backend — so importing a book on mobile failed at the first tap. The dialog
 * plugin already handles Android and iOS, and it is the same one the desktop
 * picker uses, so both platforms now go through one code path that the backend
 * actually answers.
 */
export async function pickBookFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    filters: [{ name: "Books", extensions: await dialogExtensions() }]
  });

  if (!selected) {
    return [];
  }
  return Array.isArray(selected) ? selected : [selected];
}
