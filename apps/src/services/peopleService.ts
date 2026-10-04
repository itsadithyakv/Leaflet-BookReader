import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Entry } from "../readers/people/model";
import { entriesOf, isPeopleRow, toRow, type EntryDraft, type PeopleRow } from "../readers/people/rows";

/**
 * A book's characters: what the reader has written down about the people in
 * it. Kept in the database beside the highlights (and so in the backup), one
 * row per name, note and link, so copies merge entry by entry.
 *
 * The browser preview has no database; it keeps them in its own storage so
 * the reader can be tried (and tested) there.
 */
const PREVIEW_KEY = "leaflet.people.preview";
const previewAll = (): PeopleRow[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as PeopleRow[]) : [];
  } catch {
    return [];
  }
};
const previewWrite = (all: PeopleRow[]) => {
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(all));
  } catch {
    // The preview only.
  }
};

export const peopleService = {
  /** A book's entries, without deleted ones. */
  async list(bookId: string): Promise<Entry[]> {
    if (!isTauri()) {
      return entriesOf(previewAll().filter((row) => row.bookId === bookId && !row.deletedAt && isPeopleRow(row)));
    }
    return entriesOf(await invoke<PeopleRow[]>("people_list", { bookId }));
  },

  /** Saves entries, new or changed: all of them or none. */
  async save(drafts: EntryDraft[]): Promise<Entry[]> {
    if (drafts.length === 0) {
      return [];
    }
    const inputs = drafts.map(toRow);
    if (!isTauri()) {
      const all = previewAll();
      const now = new Date().toISOString();
      const before = new Map(all.map((row) => [row.id, row]));
      const rows: PeopleRow[] = inputs.map((input) => ({
        ...input,
        createdAt: before.get(input.id)?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null
      }));
      const ids = new Set(rows.map((row) => row.id));
      previewWrite([...all.filter((row) => !ids.has(row.id)), ...rows]);
      return entriesOf(rows);
    }
    return entriesOf(await invoke<PeopleRow[]>("people_save", { inputs }));
  },

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    if (!isTauri()) {
      const gone = new Set(ids);
      previewWrite(previewAll().filter((row) => !gone.has(row.id)));
      return;
    }
    await invoke("people_delete", { ids });
  }
};
