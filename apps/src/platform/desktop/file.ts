import { open } from "@tauri-apps/plugin-dialog";
import { IMPORTABLE_EXTENSIONS } from "../../constants/bookFormats";

export async function pickBookFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    filters: [
      { name: "Books", extensions: IMPORTABLE_EXTENSIONS }
    ]
  });

  if (!selected) {
    return [];
  }

  if (Array.isArray(selected)) {
    return selected.map((item) => item.toString());
  }

  return [selected.toString()];
}
