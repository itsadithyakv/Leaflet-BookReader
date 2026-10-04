import { UiIcon } from "../components/UiIcon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MIN_QUERY, searchBook, type SearchHit } from "./searchBook";

type SearchPanelProps = {
  /** The open epub.js book. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  book: any;
  /** The chapter a section belongs to, for labelling results. */
  chapterOf: (section: number) => string | null;
  onOpen: (hit: SearchHit) => void;
  onClose: () => void;
  /** Words to search for straight away (text selected in the book); the panel opens empty without it. */
  initialQuery?: string;
};

const LIMIT = 200;
const DEBOUNCE_MS = 350;

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
export const SearchPanel = ({ book, chapterOf, onOpen, onClose, initialQuery = "" }: SearchPanelProps) => {
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const words = query.trim();
    setHits([]);
    if (words.length < MIN_QUERY) {
      setProgress(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setProgress(0);
      void searchBook(book, words, {
        signal: controller.signal,
        limit: LIMIT,
        onProgress: (fraction, found) => {
          if (!controller.signal.aborted) {
            setProgress(fraction);
            setHits([...found]);
          }
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
                : `${hits.length >= LIMIT ? `First ${LIMIT}` : hits.length} ${hits.length === 1 ? "match" : "matches"}`}
        </span>
      </div>
      {searching && (
        <div className="mt-1 h-0.5 overflow-hidden rounded-full reader-border" aria-hidden>
          <div className="h-full bg-current opacity-50 transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
        </div>
      )}
      <ol className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {hits.map((hit, index) => {
          const chapter = chapterOf(hit.section);
          const previous = index > 0 ? chapterOf(hits[index - 1].section) : undefined;
          return (
            <li key={`${hit.cfi}-${index}`}>
              {chapter && chapter !== previous && (
                <div className="mb-1 mt-2 text-[10px] uppercase tracking-widest reader-muted first:mt-0">{chapter}</div>
              )}
              <button type="button" className="reader-search-hit w-full rounded-lg px-2 py-1.5 text-left" onClick={() => onOpen(hit)}>
                {marked(hit.excerpt, words)}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
