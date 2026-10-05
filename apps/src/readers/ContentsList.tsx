import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { bookOfRow, bookStandings, listRows, type BookStanding, type ContentsRow, type InnerBook, type ListRow, type PlaceInSections } from "./innerBooks";
import type { TocItem } from "./readerTypes";
import "./contentsList.css";

type ContentsListProps = {
  /** The contents, flat, in reading order. */
  toc: TocItem[];
  /** The same entries with their depth and section, and the books inside a set (none for a single work). */
  rows: ContentsRow[];
  books: InnerBook[];
  /** Each section's size, for how far through each book the reading is. */
  bytes: readonly number[];
  /** The entry being read (its place in `toc`), or -1. */
  active: number;
  /** Where the reading has got to (what the progress stands for), and whether the whole file is finished. */
  place: PlaceInSections | null;
  finished: boolean;
  /** The list is showing: it opens scrolled to the entry being read. */
  open: boolean;
  loading: boolean;
  /** The list was made by Leaflet for a book that came with none: said in a quiet line at its head. */
  made?: boolean;
  onGo: (item: TocItem) => void;
};

/** After the reader has moved the list by hand, it is left where they put it for this long. */
const HANDS_OFF_MS = 10_000;

/** With more rows than this, the books not being read start folded away. */
const FOLD_OTHERS_OVER = 60;

const standingWords = (standing: BookStanding) =>
  standing.state === "read" ? "Read" : standing.state === "reading" ? `${Math.round(standing.fraction * 100)}%` : "Not started";

const standingSentence = (standing: BookStanding) =>
  standing.state === "read"
    ? "read"
    : standing.state === "reading"
      ? `being read, ${Math.round(standing.fraction * 100)}% through`
      : "not started";

/**
 * The chapter list. A single work is one run of rows, as it always was. A
 * set of books (readers/innerBooks.ts) is grouped by book: each has a header
 * that stays in view while its chapters scroll, says which book of how many
 * it is and how it stands (read, how far through, not started), and folds its
 * chapters away; its cover, maps and appendices are set quieter than its
 * chapters, and where the story ends is marked as an end.
 */
export const ContentsList = memo(({ toc, rows, books, bytes, active, place, finished, open, loading, made, onGo }: ContentsListProps) => {
  const scroller = useRef<HTMLDivElement | null>(null);
  /**
   * Books the reader folded or unfolded by hand: true is open. Kept by the
   * book's name, so the choice holds when the contents are replaced under
   * the list (a made chapter list arriving).
   */
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  /** When the reader last moved the list themselves (a wheel, a drag, a key). */
  const touchedAt = useRef(0);
  const wasOpen = useRef(false);
  const list = useMemo(() => (books.length > 0 ? listRows(rows, books) : []), [rows, books]);
  const standings = useMemo(() => bookStandings(books, bytes, place, finished), [books, bytes, place?.section, place?.within, finished]);
  const activeBook = active >= 0 ? bookOfRow(books, active) : -1;
  const readingBook = standings.findIndex((standing) => standing.state === "reading");
  const isOpen = (book: number) =>
    chosen[books[book].label] ?? (toc.length <= FOLD_OTHERS_OVER || book === activeBook || (activeBook < 0 && book === readingBook));

  // Opens scrolled to the entry being read, in the middle of the list. While
  // it stays open it keeps that entry in view as the reading moves on, and
  // when the contents are replaced under it; but a list the reader has just
  // moved by hand is left where they put it.
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!open) {
      touchedAt.current = 0;
      return;
    }
    const box = scroller.current;
    const row = box?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!box || !row) {
      return;
    }
    const frame = box.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    // (Clear of a book's header, which stays at the top of the list.)
    const inView = at.top >= frame.top + 80 && at.bottom <= frame.bottom - 8;
    if (!opening && (inView || Date.now() - touchedAt.current < HANDS_OFF_MS)) {
      return;
    }
    box.scrollTop = Math.max(0, at.top - frame.top + box.scrollTop - (box.clientHeight - row.offsetHeight) / 2);
  }, [open, toc, books, active]);
  const touched = () => {
    touchedAt.current = Date.now();
  };
  const hands = { onWheel: touched, onPointerDown: touched, onTouchStart: touched, onKeyDown: touched };
  const madeLine = made ? <div className="reader-toc-made">Chapters found by Leaflet</div> : null;

  const rowButton = (item: TocItem, entry: number, extra = "", indent = 0) => {
    const current = entry === active;
    return (
      <button
        key={`${entry}-${item.href}`}
        type="button"
        className={`reader-chapter-link mb-2 w-full rounded-lg px-3 py-2 text-left text-sm transition reader-icon ${
          current ? "reader-chapter-active font-semibold" : ""
        } ${extra}`}
        style={indent > 0 ? { paddingLeft: `${12 + indent * 14}px` } : undefined}
        aria-current={current ? "location" : undefined}
        onClick={() => onGo(item)}
      >
        <span>{item.label}</span>
      </button>
    );
  };

  if (toc.length === 0) {
    return (
      <div ref={scroller} className="mt-4 flex-1 overflow-y-auto pr-2">
        <div className="text-xs reader-muted">{loading ? "Loading chapters..." : "No chapters found."}</div>
      </div>
    );
  }

  if (books.length === 0) {
    return (
      <div ref={scroller} className="mt-4 flex-1 overflow-y-auto pr-2" {...hands}>
        {madeLine}
        {toc.map((item, entry) => rowButton(item, entry))}
      </div>
    );
  }

  const quiet = (row: ListRow) => rowButton(toc[row.entry], row.entry, "reader-toc-quiet", row.depth);
  const onHeaderKey = (event: KeyboardEvent<HTMLButtonElement>, book: number) => {
    // Right unfolds and Left folds, as in a tree; Enter and Space toggle (it is a button).
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      setChosen((was) => ({ ...was, [books[book].label]: event.key === "ArrowRight" }));
    }
  };

  const before = list.filter((row) => row.kind === "loose" && row.entry < books[0].firstRow);
  const after = list.filter((row) => row.kind === "loose" && row.entry > books[books.length - 1].lastRow);
  return (
    <div ref={scroller} className="reader-toc-set mt-4 flex-1 overflow-y-auto pr-2" {...hands}>
      {madeLine}
      {before.length > 0 && <div className="reader-toc-loose">{before.map(quiet)}</div>}
      {books.map((book, at) => {
        const standing = standings[at];
        const shown = isOpen(at);
        const mine = list.filter((row) => row.book === at && row.kind !== "header");
        const front = mine.filter((row) => row.kind === "front");
        // The book's own entry is a row too when nothing else opens its page.
        const own = list.find((row) => row.book === at && row.kind === "header");
        if (own && !mine.some((row) => rows[row.entry].spine === rows[own.entry].spine)) {
          front.unshift(own);
        }
        const chapters = mine.filter((row) => row.kind === "chapter");
        const back = mine.filter((row) => row.kind === "back");
        const bodyId = `reader-toc-book-${at}`;
        return (
          <section key={`${at}-${book.label}`} className="reader-toc-book" data-state={standing.state} data-current={at === activeBook ? "true" : undefined}>
            <button
              type="button"
              className="reader-toc-book-head"
              aria-expanded={shown}
              aria-controls={bodyId}
              aria-label={`${book.label}, book ${at + 1} of ${books.length}, ${standingSentence(standing)}`}
              title={shown ? "Fold this book's chapters away" : "Show this book's chapters"}
              onClick={() => setChosen((was) => ({ ...was, [book.label]: !shown }))}
              onKeyDown={(event) => onHeaderKey(event, at)}
            >
              <span className="reader-toc-book-fold" aria-hidden="true">
                {shown ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
              <span className="reader-toc-book-name">
                <span className="reader-toc-book-count">
                  Book {at + 1} of {books.length}
                </span>
                <span className="reader-toc-book-title">{book.label}</span>
              </span>
              <span className="reader-toc-book-standing">
                {standing.state === "read" && <Check size={13} aria-hidden="true" />}
                {standingWords(standing)}
              </span>
              <span className="reader-toc-book-meter" aria-hidden="true">
                <span style={{ width: `${Math.round(standing.fraction * 100)}%` }} />
              </span>
            </button>
            <div id={bodyId} className="reader-toc-book-body" hidden={!shown}>
              {shown && (
                <>
                  {front.map(quiet)}
                  {chapters.map((row) => rowButton(toc[row.entry], row.entry, "", row.depth))}
                  <div className="reader-toc-end" role="separator" aria-label={`End of ${book.label}`}>
                    <span>End of {book.label}</span>
                  </div>
                  {back.map(quiet)}
                </>
              )}
            </div>
          </section>
        );
      })}
      {after.length > 0 && <div className="reader-toc-loose reader-toc-after">{after.map(quiet)}</div>}
    </div>
  );
});
ContentsList.displayName = "ContentsList";
