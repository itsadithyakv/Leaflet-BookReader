import { useEffect, useMemo, useState } from "react";
import { friendsService, type LibraryBook, type ReaderLibrary as Library } from "../../services/friendsService";
import { errorText } from "./format";
import "./friends.css";

type Filter = "all" | "common" | "reading" | "finished";

const FILTERS: Array<{ id: Filter; label: string; keep: (book: LibraryBook) => boolean }> = [
  { id: "all", label: "All", keep: () => true },
  { id: "common", label: "In common", keep: (book) => book.inYours },
  { id: "reading", label: "Reading", keep: (book) => book.state === "reading" },
  { id: "finished", label: "Finished", keep: (book) => book.state === "finished" }
];

/** The books being read first, then the finished, then the rest, each by title. */
const ORDER: Record<LibraryBook["state"], number> = { reading: 0, finished: 1, unread: 2 };
const byState = (a: LibraryBook, b: LibraryBook) => ORDER[a.state] - ORDER[b.state] || b.percent - a.percent || a.title.localeCompare(b.title);

/**
 * A reader's whole library, for a reader whose follow they accepted: what
 * they are reading, what they finished, and what the two libraries share.
 * It is asked for only when this is on screen, and only where the reader
 * shares it.
 */
export const ReaderLibrary = ({ handle }: { handle: string }) => {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let live = true;
    setLibrary(null);
    setError(null);
    friendsService
      .library(handle)
      .then((answer) => live && setLibrary(answer))
      .catch((cause) => live && setError(errorText(cause)));
    return () => {
      live = false;
    };
  }, [handle]);

  const sorted = useMemo(() => [...(library?.books ?? [])].sort(byState), [library]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((entry) => [entry.id, sorted.filter(entry.keep).length])) as Record<Filter, number>, [sorted]);
  const shown = sorted.filter(FILTERS.find((entry) => entry.id === filter)!.keep);

  if (error) {
    return <p className="text-xs text-on-surface-variant">{error}</p>;
  }
  if (!library) {
    return <p className="text-xs text-on-surface-variant">Opening their library…</p>;
  }
  if (sorted.length === 0) {
    return <p className="text-xs text-on-surface-variant">No books in it yet.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which books to show">
        {FILTERS.filter((entry) => entry.id === "all" || counts[entry.id] > 0).map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={filter === entry.id}
            className={`tactile-button px-2.5 py-1 text-[11px] ${filter === entry.id ? "tactile-button-primary" : ""}`}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label} <span className="tabular-nums opacity-80">{counts[entry.id]}</span>
          </button>
        ))}
      </div>
      <ul className="reader-library mt-3">
        {shown.map((book) => (
          <li key={book.key}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-on-surface">{book.title}</span>
              {book.author && <span className="block truncate text-[11px] text-on-surface-variant">{book.author}</span>}
            </span>
            {book.inYours && (
              <span className="state-chip is-yours" title="In your library too">
                Yours too
              </span>
            )}
            {book.state === "reading" && <span className="state-chip is-reading">{book.percent}%</span>}
            {book.state === "finished" && <span className="state-chip">Finished</span>}
          </li>
        ))}
      </ul>
    </div>
  );
};
