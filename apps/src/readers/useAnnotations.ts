import { useCallback, useEffect, useMemo, useState } from "react";
import { annotationService, type Annotation, type AnnotationInput } from "../services/annotationService";
import { useLibraryStore } from "../store/libraryStore";

/** Where bookmarks lived before the database, per book. Moved once, then removed. */
const legacyKey = (bookId: string) => `leaflet.bookmarks.${bookId}`;
type LegacyBookmark = { id: string; cfi: string; label: string; createdAt: string };

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * A book's bookmarks and highlights, kept in the database (and so in the
 * backup). Changes schedule a backup, like closing a book does.
 */
export const useAnnotations = (bookId: string) => {
  const [items, setItems] = useState<Annotation[]>([]);
  const requestBackup = useLibraryStore((state) => state.requestBackup);

  useEffect(() => {
    let live = true;
    const load = async () => {
      // Bookmarks from before the database move over once.
      try {
        const raw = localStorage.getItem(legacyKey(bookId));
        const legacy = raw ? (JSON.parse(raw) as LegacyBookmark[]) : [];
        if (Array.isArray(legacy) && legacy.length > 0) {
          for (const bookmark of legacy) {
            if (bookmark?.cfi) {
              await annotationService.save({
                id: bookmark.id || newId(),
                bookId,
                kind: "bookmark",
                cfi: bookmark.cfi,
                chapter: bookmark.label ?? null
              });
            }
          }
        }
        localStorage.removeItem(legacyKey(bookId));
      } catch {
        // Unreadable old bookmarks are left where they were.
      }
      const loaded = await annotationService.list(bookId).catch(() => [] as Annotation[]);
      if (live) {
        setItems(loaded);
      }
    };
    setItems([]);
    void load();
    return () => {
      live = false;
    };
  }, [bookId]);

  const save = useCallback(
    async (input: AnnotationInput) => {
      const saved = await annotationService.save(input);
      setItems((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      requestBackup();
      return saved;
    },
    [requestBackup]
  );

  const addBookmark = useCallback(
    (cfi: string, chapter: string | null) => save({ id: newId(), bookId, kind: "bookmark", cfi, chapter }),
    [bookId, save]
  );

  const addHighlight = useCallback(
    (cfi: string, text: string, chapter: string | null, color: string, note: string | null = null) =>
      save({ id: newId(), bookId, kind: "highlight", cfi, text, chapter, color, note }),
    [bookId, save]
  );

  const update = useCallback(
    (id: string, patch: Partial<Pick<Annotation, "note" | "color">>) => {
      const current = items.find((item) => item.id === id);
      if (!current) {
        return Promise.resolve(null);
      }
      const { createdAt: _c, updatedAt: _u, deletedAt: _d, ...input } = current;
      return save({ ...input, ...patch });
    },
    [items, save]
  );

  const remove = useCallback(
    async (id: string) => {
      await annotationService.remove(id);
      setItems((current) => current.filter((item) => item.id !== id));
      requestBackup();
    },
    [requestBackup]
  );

  const bookmarks = useMemo(
    () => items.filter((item) => item.kind === "bookmark").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [items]
  );
  const highlights = useMemo(() => items.filter((item) => item.kind === "highlight"), [items]);

  return { bookmarks, highlights, addBookmark, addHighlight, update, remove };
};

/** A book's highlights and notes as Markdown, for pasting elsewhere. */
export const highlightsMarkdown = (title: string, author: string | null | undefined, highlights: Annotation[]) => {
  const lines = [`# ${title}`];
  if (author) {
    lines.push(`*${author}*`);
  }
  let chapter: string | null | undefined;
  for (const item of highlights) {
    if (item.chapter && item.chapter !== chapter) {
      chapter = item.chapter;
      lines.push("", `## ${chapter}`);
    }
    lines.push("", ...(item.text ?? "").split("\n").map((line) => `> ${line}`));
    if (item.note) {
      lines.push("", item.note);
    }
  }
  return `${lines.join("\n")}\n`;
};
