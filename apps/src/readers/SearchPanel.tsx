import { UiIcon } from "../components/UiIcon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FOLD_BOOKS_OVER, MIN_QUERY, groupByBook, searchBook, tally, type SearchHit } from "./searchBook";

type SearchPanelProps = {
  /** The open epub.js book. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  book: any;
  /** The chapter a section belongs to, for labelling results. */
  chapterOf: (section: number) => string | null;
  /**
   * In a set of books (readers/innerBooks.ts): the books' names in order,
   * the book a section is in (-1 outside every book), the chapter's own name
   * without its book's, and the book being read. Results are then grouped
   * under a header for each book.
   */
  books?: string[];
  bookOf?: (section: number) => number;
  chapterNameOf?: (section: number) => string | null;
  readingBook?: number;
  onOpen: (hit: SearchHit) => void;
  onClose: () => void;
  /** Words to search for straight away (text selected in the book); the panel opens empty without it. */
  initialQuery?: string;
};

/**
 * A few matches are kept from each section and all of them counted, so the
 * list reaches the end of the book however common the word (readers/searchBook.ts).
 */
const LIMIT = 1500;
const PER_SECTION = 4;
const DEBOUNCE_MS = 350;
/** The list is drawn again this often while results arrive, not once a section: a long book has hundreds. */
const REDRAW_MS = 400;

/** Bolds each occurrence of the query in an excerpt. */
const marked = (excerpt: string, query: string): ReactNode[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [excerpt];
  }
  const out: ReactNode[] = [];
  const lower = excerpt.toLowerCase();
  let at = 0;
  for (let found = lower.indexOf(needle); found >= 0; found = lower.indexOf(needle, at)) {
    out.push(excerpt.slice(at, found), <mark key={found}>{excerpt.slice(found, found + needle.length)}</mark>);
    at = found + needle.length;
  }
  out.push(excerpt.slice(at));
  return out;
};

/**
 * Search inside the book: type, and results arrive section by section with
 * their chapter. Selecting one jumps there and marks the words for a moment.
 * Escape closes it; Enter opens the first result.
 */
export const SearchPanel = ({ book, chapterOf, books, bookOf, chapterNameOf, readingBook, onOpen, onClose, initialQuery = "" }: SearchPanelProps) => {
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<SearchHit[]>([]);
  /** Every match found, by section: the ones not listed are still counted. */
  const [counts, setCounts] = useState<ReadonlyMap<number, number>>(new Map());
  const [progress, setProgress] = useState<number | null>(null);
  /** Books of a set the reader folded or unfolded by hand, by name: true is open. */
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const words = query.trim();
    setHits([]);
    setCounts(new Map());
    if (words.length < MIN_QUERY) {
      setProgress(null);
      return;
    }
    // Searching from the first key press, so "No matches" is never said of a search that has not begun.
    setProgress(0);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      let drawnAt = 0;
      void searchBook(book, words, {
        signal: controller.signal,
        limit: LIMIT,
        perSection: PER_SECTION,
        onProgress: (fraction, found, tallied) => {
          const now = Date.now();
          if (controller.signal.aborted || (fraction < 1 && now - drawnAt < REDRAW_MS)) {
            return;
          }
          drawnAt = now;
          setProgress(fraction);
          setHits([...found]);
          setCounts(new Map(tallied));
        }
      }).then(() => {
        if (!controller.signal.aborted) {
          setProgress(1);
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [book, query]);

  const searching = progress !== null && progress < 1;
  const words = query.trim();
  const found = tally(counts);
  // The matches of each chapter, listed or not. A chapter is a run of
  // sections under one name (it can be split over several files); the name
  // alone will not do, a set has thirty-five chapters called "Tyrion".
  const groupOf = new Map<number, { all: number; listed: number }>();
  let chapters = 0;
  let run: { all: number; listed: number } | null = null;
  let runLabel: string | null = null;
  let runEnd = -2;
  [...counts.keys()]
    .sort((a, b) => a - b)
    .forEach((section) => {
      const label = chapterOf(section);
      if (!run || label !== runLabel || section !== runEnd + 1) {
        run = { all: 0, listed: 0 };
        runLabel = label;
        chapters += 1;
      }
      runEnd = section;
      run.all += counts.get(section) ?? 0;
      groupOf.set(section, run);
    });
  hits.forEach((hit) => {
    const group = groupOf.get(hit.section);
    if (group) {
      group.listed += 1;
    }
  });

  // In a set of books (readers/innerBooks.ts) the results are grouped by book.
  const inSet = Boolean(books && books.length > 1 && bookOf);
  const byBook = inSet && bookOf ? groupByBook(hits, counts, bookOf) : [];
  const isOpen = (group: number) => chosen[books?.[group] ?? ""] ?? (hits.length <= FOLD_BOOKS_OVER || group === readingBook);

  /** One result, with its chapter's heading before the first of a chapter's matches. Under a book's header the chapter is named alone. */
  const row = (hit: SearchHit, index: number, underBook: boolean) => {
    const chapter = (underBook ? chapterNameOf?.(hit.section) : null) ?? chapterOf(hit.section);
    const group = groupOf.get(hit.section);
    const first = index === 0 || groupOf.get(hits[index - 1].section) !== group;
    const last = index + 1 >= hits.length || groupOf.get(hits[index + 1].section) !== group;
    const all = group?.all ?? 0;
    const more = group ? group.all - group.listed : 0;
    return (
      <li key={`${hit.cfi}-${index}`}>
        {chapter && first && (
          <div className="mb-1 mt-2 flex items-baseline justify-between gap-2 text-[10px] uppercase tracking-widest reader-muted first:mt-0">
            <span>{chapter}</span>
            {all > 1 && <span className="tabular-nums">{all.toLocaleString()}</span>}
          </div>
        )}
        <button type="button" className="reader-search-hit w-full rounded-lg px-2 py-1.5 text-left" onClick={() => onOpen(hit)}>
          {marked(hit.excerpt, words)}
        </button>
        {last && more > 0 && (
          <div className="px-2 pb-1 text-[10px] reader-muted">
            and {more.toLocaleString()} more in this chapter
          </div>
        )}
      </li>
    );
  };

  return (
    <div
      className="reader-search fixed right-4 top-20 z-[60] flex max-h-[70vh] w-[22rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border"
      role="dialog"
      aria-label="Search in this book"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <UiIcon name="search" size={16} className="reader-muted" aria-hidden />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && hits[0]) {
              onOpen(hits[0]);
            }
          }}
          placeholder="Search in this book"
          aria-label="Search in this book"
          className="reader-notes-input min-w-0 flex-1"
        />
        <button type="button" className="reader-mini-control" onClick={onClose} aria-label="Close search">
          <UiIcon name="close" size={16} />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-widest reader-muted" aria-live="polite">
        <span>
          {words.length < MIN_QUERY
            ? "Type a word or phrase"
            : searching
              ? `Searching… ${Math.round((progress ?? 0) * 100)}%`
              : hits.length === 0
                ? "No matches"
                : `${found.matches.toLocaleString()} ${found.matches === 1 ? "match" : "matches"}${found.sections > 1 ? ` in ${chapters.toLocaleString()} chapters` : ""}`}
        </span>
      </div>
      {searching && (
        <div className="mt-1 h-0.5 overflow-hidden rounded-full reader-border" aria-hidden>
          <div className="h-full bg-current opacity-50 transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
        </div>
      )}
      {inSet ? (
        // A set of books: the results under a header for each book, with its
        // count; the book being read is unfolded and the others fold away.
        <div className="reader-search-books mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {byBook.map((group, at) => {
            const title = group.book >= 0 ? (books?.[group.book] ?? "") : null;
            const open = title === null || isOpen(group.book);
            return (
              <section key={`${group.book}-${at}`} aria-label={title ?? "Outside the books"}>
                {title !== null && (
                  <button
                    type="button"
                    className="reader-search-book"
                    aria-expanded={open}
                    aria-label={`${title}, book ${group.book + 1} of ${books?.length ?? 0}, ${group.matches.toLocaleString()} ${group.matches === 1 ? "match" : "matches"}`}
                    onClick={() => setChosen((was) => ({ ...was, [title]: !open }))}
                  >
                    {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    <span className="reader-search-book-name">
                      <span className="reader-search-book-count">
                        Book {group.book + 1} of {books?.length ?? 0}
                      </span>
                      <span className="reader-search-book-title">{title}</span>
                    </span>
                    <span className="tabular-nums">{group.matches.toLocaleString()}</span>
                  </button>
                )}
                {open && <ol className="space-y-1">{group.hits.map(({ hit, index }) => row(hit, index, group.book >= 0))}</ol>}
              </section>
            );
          })}
        </div>
      ) : (
        <ol className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">{hits.map((hit, index) => row(hit, index, false))}</ol>
      )}
    </div>
  );
};
