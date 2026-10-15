import { open } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { IMPORTABLE_EXTENSIONS, setSupportedFormats, type BookFormat } from "../../constants/bookFormats";
import { android, onAndroid } from "../android";

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
 * On Android the system picker hands over `content://` addresses, which the
 * importer cannot open; Leaflet's own picker (`android.pickFiles`) copies each
 * chosen file into Leaflet's storage and answers with those paths. Elsewhere
 * (iOS, one day) the dialog plugin's picker.
 */
export async function pickBookFiles(): Promise<string[]> {
  if (onAndroid()) {
    return android.pickFiles("books", true);
  }
  const selected = await open({
    multiple: true,
    filters: [{ name: "Books", extensions: await dialogExtensions() }]
  });

  if (!selected) {
    return [];
  }
  return Array.isArray(selected) ? selected : [selected];
}
