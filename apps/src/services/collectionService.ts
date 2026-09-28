import { invoke, isTauri } from "@tauri-apps/api/core";

/** A collection the reader made, as the database keeps it. */
export type Collection = {
  id: string;
  name: string;
  /** In the order the books were added. */
  bookIds: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type CollectionInput = Pick<Collection, "id" | "name" | "bookIds">;

/** The browser preview has no database; it keeps collections in its own storage. */
const PREVIEW_KEY = "leaflet.collections.preview";
const previewAll = (): Collection[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Collection[]) : [];
  } catch {
    return [];
  }
};
const previewWrite = (all: Collection[]) => {
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(all));
  } catch {
    // The preview only.
  }
};

export const collectionService = {
  async list(): Promise<Collection[]> {
    if (!isTauri()) {
      return previewAll();
    }
    return invoke<Collection[]>("collections_list");
  },

  async save(input: CollectionInput): Promise<Collection> {
    if (!isTauri()) {
      const all = previewAll();
      const now = new Date().toISOString();
      const existing = all.find((item) => item.id === input.id);
      const saved: Collection = {
        ...input,
        name: input.name.trim(),
        bookIds: [...new Set(input.bookIds)],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      previewWrite(existing ? all.map((item) => (item.id === input.id ? saved : item)) : [...all, saved]);
      return saved;
    }
    return invoke<Collection>("collection_save", { input });
  },

  async remove(id: string): Promise<void> {
    if (!isTauri()) {
      previewWrite(previewAll().filter((item) => item.id !== id));
      return;
    }
    await invoke("collection_delete", { id });
  }
};
