import { invoke, isTauri } from "@tauri-apps/api/core";

/** A bookmark or a highlight (with an optional note), as the database keeps it. */
export type Annotation = {
  id: string;
  bookId: string;
  kind: "bookmark" | "highlight";
  /** Where: a CFI, a range for a highlight. */
  cfi: string;
  text?: string | null;
  note?: string | null;
  color?: string | null;
  chapter?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type AnnotationInput = Omit<Annotation, "createdAt" | "updatedAt" | "deletedAt">;

/** How many highlights a book has. */
export type HighlightCount = { bookId: string; count: number };

/**
 * The browser preview has no database; it keeps annotations in its own
 * storage so the reader can be tried (and tested) there.
 */
const PREVIEW_KEY = "leaflet.annotations.preview";
const previewAll = (): Annotation[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Annotation[]) : [];
  } catch {
    return [];
  }
};
const previewWrite = (all: Annotation[]) => {
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(all));
  } catch {
    // The preview only.
  }
};

export const annotationService = {
  async list(bookId: string): Promise<Annotation[]> {
    if (!isTauri()) {
      return previewAll().filter((item) => item.bookId === bookId && !item.deletedAt);
    }
    return invoke<Annotation[]>("annotations_list", { bookId });
  },

  /**
   * Each book's number of highlights, for the books that have any (bookmarks
   * and deleted highlights are not counted). Lets the library list them
   * without loading every highlight.
   */
  async highlightCounts(): Promise<HighlightCount[]> {
    if (!isTauri()) {
      const counts = new Map<string, number>();
      for (const item of previewAll()) {
        if (item.kind === "highlight" && !item.deletedAt) {
          counts.set(item.bookId, (counts.get(item.bookId) ?? 0) + 1);
        }
      }
      return [...counts].map(([bookId, count]) => ({ bookId, count }));
    }
    return invoke<HighlightCount[]>("annotations_highlight_counts");
  },

  async save(input: AnnotationInput): Promise<Annotation> {
    if (!isTauri()) {
      const all = previewAll();
      const now = new Date().toISOString();
      const existing = all.find((item) => item.id === input.id);
      const saved: Annotation = { ...input, createdAt: existing?.createdAt ?? now, updatedAt: now, deletedAt: null };
      previewWrite([...all.filter((item) => item.id !== input.id), saved]);
      return saved;
    }
    return invoke<Annotation>("annotation_save", { input });
  },

  async remove(id: string): Promise<void> {
    if (!isTauri()) {
      previewWrite(previewAll().filter((item) => item.id !== id));
      return;
    }
    await invoke("annotation_delete", { id });
  }
};
