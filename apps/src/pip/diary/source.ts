import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DiaryBookRow, DiaryMarkRow } from "./facts";

/**
 * What the diary is written from, beyond the habit snapshot: each book's name
 * and how far it is, and the highlights, characters and words by the day they
 * were made (`commands/diary.rs`). Read when the diary opens; nothing is
 * written.
 */
export type DiaryRows = { books: DiaryBookRow[]; marks: DiaryMarkRow[] };

/** An annotation row, as far as a diary line needs it. */
type Row = {
  id: string;
  bookId: string;
  kind: string;
  cfi?: string | null;
  text?: string | null;
  note?: string | null;
  chapter?: string | null;
  createdAt: string;
  deletedAt?: string | null;
};

const MARK_KINDS = ["highlight", "person", "word"];
const MAX_QUOTE = 200;

/** A row as a mark, cut down as the backend cuts it; null for a kind the diary does not use. */
export const markOf = (row: Row): DiaryMarkRow | null => {
  if (row.deletedAt || !MARK_KINDS.includes(row.kind)) {
    return null;
  }
  const highlight = row.kind === "highlight";
  return {
    id: row.id,
    bookId: row.bookId,
    kind: row.kind,
    words: highlight ? (row.text ?? "").slice(0, MAX_QUOTE) || null : row.note ?? null,
    detail: highlight ? null : row.text ?? null,
    chapter: row.chapter ?? null,
    hasPlace: Boolean(row.cfi && row.cfi.trim()),
    createdAt: row.createdAt
  };
};

/**
 * The browser preview has no database. Its readers keep their annotations in
 * its own storage (annotationService, peopleService, wordService), so the
 * diary there is written from those.
 */
const PREVIEW_KEYS = ["leaflet.annotations.preview", "leaflet.people.preview", "leaflet.words.preview"];

const previewMarks = (): DiaryMarkRow[] => {
  const marks: DiaryMarkRow[] = [];
  for (const key of PREVIEW_KEYS) {
    try {
      const rows: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(rows)) {
        for (const row of rows as Row[]) {
          const mark = row && typeof row === "object" && typeof row.createdAt === "string" ? markOf(row) : null;
          if (mark) {
            marks.push(mark);
          }
        }
      }
    } catch {
      // The preview only.
    }
  }
  return marks.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
};

/** A book in the library, which in the app also carries when it last moved. */
type LibraryBook = { id: string; title: string; author?: string | null; progress: number; lastOpened?: string | null; progressUpdatedAt?: string | null };

export const loadDiaryRows = async (library: LibraryBook[]): Promise<DiaryRows> => {
  if (isTauri()) {
    return invoke<DiaryRows>("diary_sources");
  }
  return {
    // The preview's books have no "last moved"; when one was last opened stands in.
    books: library.map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author ?? null,
      progress: book.progress,
      progressUpdatedAt: book.progressUpdatedAt ?? (book.progress > 0 ? book.lastOpened ?? null : null),
      lastOpened: book.lastOpened ?? null
    })),
    marks: previewMarks()
  };
};
