import { useEffect, useMemo, useRef, useState } from "react";
import { UiIcon } from "../components/UiIcon";
import { MIN_QUERY } from "./pdfText";
import { hitsInPageOrder, nextHitIndex, searchPdf, type PdfSearchHit, type PdfSearchState } from "./pdfSearch";

type PdfSearchPanelProps = {
  pageCount: number;
  /** The page the reader is on: where the search begins, and where Enter starts from. */
  page: number;
  /** A page's searchable text; asked for a page at a time as the search reaches it. */
  textOf: (page: number) => Promise<string>;
  /** The result on show, marked in the list. */
  active: PdfSearchHit | null;
  /** Bumped when Ctrl+F is pressed with the panel already open: back to the field. */
  focusToken: number;
  /** The words the panel opens on: the PDF was opened at a match of the library's search (readers/pdfFindPlace.ts). */
  initialQuery?: string;
  /** The phrase now being searched for ("" when there is none), so the page can mark it. */
  onQuery: (query: string) => void;
  onOpen: (hit: PdfSearchHit) => void;
  onClose: () => void;
};

const LIMIT = 200;
const DEBOUNCE_MS = 300;

const sameHit = (a: PdfSearchHit | null, b: PdfSearchHit) => a !== null && a.page === b.page && a.nth === b.nth;

/**
 * Search inside a PDF, in the look of the text reader's search
 * (SearchPanel.tsx): type, and results arrive page by page as the document is
 * read. Choosing one goes to its page and marks the words there. Enter goes
 * to the next result and Shift+Enter to the one before; Escape closes.
 *
 * The search begins at the reader's page and comes round to the pages before
 * it, and Enter starts from that page: it used to begin at page 1 and stop at
 * 200 results, so a common word could not be found from the middle of a book
 * at all. The list is in page order all the same.
 */
export const PdfSearchPanel = ({
  pageCount,
  page,
  textOf,
  active,
  focusToken,
  initialQuery = "",
  onQuery,
  onOpen,
  onClose
}: PdfSearchPanelProps) => {
  const [query, setQuery] = useState(initialQuery);
  const [found, setFound] = useState<PdfSearchState | null>(null);
  // The page the search on show began at.
  const [began, setBegan] = useState(1);
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLOListElement | null>(null);
  // Read by the search effect without restarting it when a parent re-renders.
  const textOfRef = useRef(textOf);
  textOfRef.current = textOf;
  const onQueryRef = useRef(onQuery);
  onQueryRef.current = onQuery;
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusToken]);

  useEffect(() => {
    const words = query.trim();
    setFound(null);
    if (words.length < MIN_QUERY) {
      onQueryRef.current("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      onQueryRef.current(words);
      const from = Math.min(Math.max(1, pageRef.current), Math.max(1, pageCount));
      setBegan(from);
      const show = (state: PdfSearchState) => {
        if (!controller.signal.aborted) {
          setFound({ ...state, hits: [...state.hits] });
        }
      };
      show({ hits: [], fraction: 0, sawText: false, capped: false });
      void searchPdf(words, {
        pageCount,
        textOf: (page) => textOfRef.current(page),
        signal: controller.signal,
        limit: LIMIT,
        from,
        onProgress: show
      }).then((state) => show({ ...state, fraction: 1 }));
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [pageCount, query]);

  // The phrase stops being marked on the page when the search closes.
  useEffect(() => () => onQueryRef.current(""), []);

  // Stepping through results with Enter keeps the one on show in sight.
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const words = query.trim();
  const hits = useMemo(() => hitsInPageOrder(found?.hits ?? []), [found]);
  const searching = found !== null && found.fraction < 1;

  const step = (by: 1 | -1) => {
    const next = nextHitIndex(hits, active, by, page);
    if (next >= 0) {
      onOpen(hits[next]);
    }
  };

  const status =
    words.length < MIN_QUERY || found === null
      ? "Type a word or phrase"
      : searching
        ? `Searching… ${Math.round(found.fraction * 100)}%${hits.length > 0 ? ` · ${hits.length} so far` : ""}`
        : hits.length === 0
          ? found.sawText
            ? "No matches"
            : "This PDF has no text to search"
          : found.capped
            ? began > 1
              ? `${hits.length} matches from page ${began} on`
              : `First ${hits.length} matches`
            : `${hits.length} ${hits.length === 1 ? "match" : "matches"}`;

  return (
    <div
      className="reader-search fixed right-4 top-20 z-[60] flex max-h-[70vh] w-[22rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border p-4 text-xs shadow-2xl reader-panel reader-border"
      role="dialog"
      aria-label="Search in this PDF"
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
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
          }}
          placeholder="Search in this PDF"
          aria-label="Search in this PDF"
          className="reader-notes-input min-w-0 flex-1"
        />
        <button
          type="button"
          className="reader-mini-control"
          onClick={() => step(-1)}
          disabled={hits.length === 0}
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
        >
          <UiIcon name="up" size={16} />
        </button>
        <button
          type="button"
          className="reader-mini-control"
          onClick={() => step(1)}
          disabled={hits.length === 0}
          aria-label="Next match"
          title="Next match (Enter)"
        >
          <UiIcon name="down" size={16} />
        </button>
        <button type="button" className="reader-mini-control" onClick={onClose} aria-label="Close search">
          <UiIcon name="close" size={16} />
        </button>
      </div>
      <div
        className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-widest reader-muted"
        aria-live="polite"
      >
        <span>{status}</span>
      </div>
      {searching && (
        <div className="mt-1 h-0.5 overflow-hidden rounded-full reader-border" aria-hidden>
          <div
            className="h-full bg-current opacity-50 transition-[width]"
            style={{ width: `${Math.round(found.fraction * 100)}%` }}
          />
        </div>
      )}
      <ol ref={list} className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {hits.map((hit, index) => {
          const current = sameHit(active, hit);
          return (
            <li key={`${hit.page}-${hit.nth}`}>
              {(index === 0 || hits[index - 1].page !== hit.page) && (
                <div className="mb-1 mt-2 text-[10px] uppercase tracking-widest reader-muted first:mt-0">
                  Page {hit.page}
                </div>
              )}
              <button
                type="button"
                className={`reader-search-hit w-full rounded-lg px-2 py-1.5 text-left ${current ? "pdf-search-hit-current" : ""}`}
                aria-current={current ? "true" : undefined}
                onClick={() => onOpen(hit)}
              >
                {hit.snippet.before}
                <mark>{hit.snippet.match}</mark>
                {hit.snippet.after}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
