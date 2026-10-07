import { useEffect, useMemo, useRef, useState } from "react";
import type { Book } from "@shared/models/book";
import { useCoverSrc } from "../../hooks/useCoverSrc";
import { librarySearchService, type BookMatches, type LibraryMatch } from "../../services/librarySearchService";
import { useLibraryStore } from "../../store/libraryStore";
import { UiIcon } from "../UiIcon";
import { EYEBROW } from "../ui/SectionHeader";
import { MAX_QUERY, listResults, matchCount, matchPlace, searchable, statusLine, withBook, type BookResult, type SearchState } from "./librarySearch";
import { closeLibrarySearch, useLibrarySearchStore } from "./librarySearchStore";

/** Typing waits this long before a search starts; the search before it is stopped. */
const DEBOUNCE_MS = 300;
/** The list is drawn again this often while books arrive, not once a book: a large library has hundreds. */
const REDRAW_MS = 120;

const iconButton =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

const BookMatchesEntry = ({ result, onOpen }: { result: BookResult; onOpen: (book: Book, match: LibraryMatch) => void }) => {
  const { book, count, matches } = result;
  const { src, onError } = useCoverSrc(book, { thumb: true });
  return (
    <li>
      <div className="flex items-center gap-3 px-1">
        <span className="book-cover-frame block h-12 w-9 shrink-0 overflow-hidden bg-surface-container-high">
          {src && <img src={src} alt="" className="h-full w-full object-cover" onError={onError} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="book-title block truncate text-base text-on-surface">{book.title}</span>
          <span className="block truncate text-xs text-on-surface-variant">{book.author ?? "Unknown author"}</span>
        </span>
        <span
          className="shrink-0 text-xs font-semibold tabular-nums text-on-surface-variant"
          title={count > matches.length ? `The first ${matches.length} are shown. Open one to see the rest in the book.` : undefined}
        >
          {matchCount(count)}
        </span>
      </div>
      <ul className="mt-1 space-y-0.5">
        {matches.map((match, at) => (
          <li key={`${match.href}-${match.nth}-${at}`}>
            <button
              type="button"
              className="w-full rounded-lg px-3 py-2 text-left text-sm leading-relaxed text-on-surface-variant transition-colors hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => onOpen(book, match)}
              aria-label={`Open ${book.title} at: ${match.before}${match.text}${match.after}`}
            >
              {match.before}
              <mark className="rounded-sm bg-primary/25 px-0.5 font-semibold text-on-surface">{match.text}</mark>
              {match.after}
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
};

type LibrarySearchDialogProps = {
  /** A match was picked: the app opens the book the usual way, at this place (readers/findPlace.ts). */
  onOpenInBook: (book: Book, place: string) => void;
};

/**
 * Search inside every book: a word or phrase typed once, and where it is
 * written across the library, book by book, as the books are gone through.
 * Picking a match opens the book there.
 *
 * Opened from the library page (`openLibrarySearch`) and mounted once, at the
 * top of the app, like the Highlights dialog.
 */
export const LibrarySearchDialog = ({ onOpenInBook }: LibrarySearchDialogProps) => {
  const opening = useLibrarySearchStore((state) => state.query);
  const books = useLibraryStore((state) => state.books);
  const [query, setQuery] = useState(opening ?? "");
  const [found, setFound] = useState<BookMatches[]>([]);
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const open = opening !== null;
  const words = searchable(query);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    // Capture phase, as the app's other dialogs do, so nothing under this one sees the Escape.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeLibrarySearch();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => {
    setFound([]);
    if (!open || !words) {
      setState({ kind: "idle" });
      return;
    }
    // Searching from the first key press, so "No matches" is never said of a search that has not begun.
    setState({ kind: "searching", done: 0, total: 0 });
    let stale = false;
    let started = false;
    let finished = false;
    // What has arrived since the list was last drawn.
    let arrived: BookMatches[] = [];
    let progress = { done: 0, total: 0 };
    let redraw: number | null = null;
    const draw = () => {
      redraw = null;
      if (stale) {
        return;
      }
      const fresh = arrived;
      arrived = [];
      setFound((was) => fresh.reduce(withBook, was));
      setState({ kind: "searching", ...progress });
    };
    const timer = window.setTimeout(() => {
      started = true;
      librarySearchService
        .search(words, (told) => {
          // (A book told of after the answer itself has nothing to add to it.)
          if (stale || finished) {
            return;
          }
          progress = { done: told.done, total: told.total };
          if (told.book) {
            arrived.push(told.book);
          }
          redraw ??= window.setTimeout(draw, REDRAW_MS);
        })
        .then((summary) => {
          if (stale) {
            return;
          }
          finished = true;
          if (redraw !== null) {
            window.clearTimeout(redraw);
          }
          // Stopped by something other than this dialog's next search: only part of an answer.
          if (summary.stopped) {
            setState({ kind: "failed" });
            return;
          }
          setFound(summary.books);
          setState({ kind: "done", skipped: summary.skipped });
        })
        .catch(() => {
          if (stale) {
            return;
          }
          finished = true;
          if (redraw !== null) {
            window.clearTimeout(redraw);
          }
          setState({ kind: "failed" });
        });
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
      if (redraw !== null) {
        window.clearTimeout(redraw);
      }
      // The words changed or the dialog shut: the books need not be read to the end.
      if (started && !finished) {
        librarySearchService.cancel();
      }
    };
  }, [open, words]);

  const results = useMemo(() => listResults(found, books), [found, books]);

  if (!open) {
    return null;
  }

  const openMatch = (book: Book, match: LibraryMatch) => {
    if (!words) {
      return;
    }
    closeLibrarySearch();
    onOpenInBook(book, matchPlace(match, words));
  };
  const searching = state.kind === "searching";
  const skipped = state.kind === "done" ? state.skipped : 0;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeLibrarySearch();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-search-title"
        // One height, results or none: the dialog does not jump as books arrive.
        className="modal-surface confirm-pop flex h-[min(85vh,44rem)] w-full max-w-2xl flex-col rounded-2xl p-5"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={EYEBROW}>Your library</p>
            <h2 id="library-search-title" className="page-title mt-1 text-xl text-on-surface">
              Search inside books
            </h2>
          </div>
          <button type="button" className={`${iconButton} -mr-2 -mt-1`} onClick={closeLibrarySearch} aria-label="Close" title="Close">
            <UiIcon name="close" size={18} />
          </button>
        </div>

        <div className="relative mt-4">
          <UiIcon name="search" size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <input
            ref={inputRef}
            className="inset-field w-full py-2.5 pl-11 pr-4 text-sm text-on-surface focus:border-primary/40 focus:outline-none"
            type="text"
            value={query}
            maxLength={MAX_QUERY}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="A word or phrase"
            aria-label="Search inside books"
            title="Finds the words whatever their case, with or without their accents"
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-on-surface-variant">
          <span role="status" aria-live="polite">
            {statusLine(state, results)}
          </span>
          {skipped > 0 && (
            <span
              className="shrink-0 tabular-nums"
              title="PDFs and comics have no text to search. A Kindle book or a text file is searched once it has been opened, and a book not on this device once it is downloaded."
            >
              {skipped.toLocaleString()} not searched
            </span>
          )}
        </div>
        <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-surface-container-high" aria-hidden="true">
          {searching && (
            <div
              className="h-full bg-primary/70 transition-[width] duration-200"
              style={{ width: `${state.total > 0 ? Math.round((state.done / state.total) * 100) : 0}%` }}
            />
          )}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <ul className="space-y-5">
            {results.map((result) => (
              <BookMatchesEntry key={result.book.id} result={result} onOpen={openMatch} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
