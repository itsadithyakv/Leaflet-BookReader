import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Book } from "@shared/models/book";
import { UiIcon } from "../UiIcon";

type Props = {
  title: string;
  books: Book[];
  onDone: (ids: string[]) => void;
  onCancel: () => void;
};

/** Choose books to add to a collection: search, tick, add. */
export const BookPicker = ({ title, books, onDone, onCancel }: Props) => {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...books].sort((a, b) => a.title.localeCompare(b.title));
    return needle ? sorted.filter((book) => `${book.title} ${book.author ?? ""}`.toLowerCase().includes(needle)) : sorted;
  }, [books, query]);

  const toggle = (id: string) =>
    setChosen((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal-surface confirm-pop flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl p-5"
      >
        <h2 className="page-title text-xl text-on-surface">{title}</h2>
        <div className="relative mt-4">
          <UiIcon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            autoFocus
            className="inset-field w-full py-2 pl-9 pr-3 text-sm text-on-surface"
            placeholder="Search by title or author"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <ul className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {shown.length === 0 ? (
            <li className="p-4 text-center text-sm text-on-surface-variant">
              {books.length === 0 ? "Every book in your library is already here." : "No book matches."}
            </li>
          ) : (
            shown.map((book) => {
              const on = chosen.includes(book.id);
              return (
                <li key={book.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-container-high">
                    <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--color-primary))]" checked={on} onChange={() => toggle(book.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-on-surface">{book.title}</span>
                      <span className="block truncate text-xs text-on-surface-variant">{book.author ?? "Unknown author"}</span>
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" className="px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            disabled={chosen.length === 0}
            className="tactile-button tactile-button-primary px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em] disabled:opacity-50"
            onClick={() => onDone(chosen)}
          >
            {chosen.length === 0 ? "Add" : `Add ${chosen.length} book${chosen.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
