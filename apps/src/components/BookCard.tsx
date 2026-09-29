import { memo } from "react";
import type { Book } from "@shared/models/book";
import { useCoverSrc } from "../hooks/useCoverSrc";
import { isFinished } from "../constants/books";
import { useSeriesInfo } from "../library/useSeries";
import { seriesNumberLabel } from "../library/series";
import { BookMenu, type BookMenuAction } from "./BookMenu";

type Props = {
  book: Book;
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
  /** More entries for the card's menu. */
  menuActions?: BookMenuAction[];
};

const BookCardComponent = ({ book, onRefresh, onOpen, menuActions }: Props) => {
  const { src: resolvedCover, onError: handleCoverError } = useCoverSrc(book, { thumb: true });
  const series = useSeriesInfo(book.id);
  const progressPercent = Math.round(Math.min(1, Math.max(0, book.progress)) * 100);
  const finished = isFinished(book.progress);
  // Sync carries the library index to every device but leaves the files where
  // they are, so a book can be listed here with nothing to open yet.
  const needsDownload = book.available === false;

  return (
    // A card is opened like a button, so it behaves like one: reachable with
    // Tab, opened with Enter or Space, and announced with the book's name.
    <article
      role="button"
      tabIndex={0}
      aria-label={`Open ${book.title}${book.author ? ` by ${book.author}` : ""}`}
      onClick={() => onOpen(book)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen(book);
        }
      }}
      className="group flex h-full w-full cursor-pointer flex-col text-left transition-transform duration-200 hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
    >
      {/* Pip can stand on a cover, and hops between them (PipWorld). */}
      <div
        data-pip-ledge="book"
        className="book-cover-frame relative aspect-[2/3] w-full overflow-hidden transition-all duration-200 group-hover:border-primary/50"
      >
        {resolvedCover ? (
          <img
            src={resolvedCover}
            alt={book.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            onError={handleCoverError}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-surface-container-high text-xs text-on-surface-variant">
            No cover yet
          </div>
        )}
        {needsDownload && (
          <div
            className="absolute right-2 top-2 rounded-full bg-surface-container-highest/90 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-on-surface-variant"
            title="On your other device. Opening this will download it."
          >
            Cloud
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="absolute inset-0 flex items-end p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <button
            type="button"
            className="tactile-button tactile-button-primary w-full py-2 text-sm font-bold"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(book);
            }}
          >
            {needsDownload ? "Download" : "Resume Reading"}
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-start gap-1 pt-4">
        <div className="min-w-0 flex-1">
          <p className="book-title truncate text-lg text-on-surface" title={book.title}>
            {book.title}
          </p>
          <p className="truncate text-xs text-on-surface-variant">{book.author ?? "Unknown author"}</p>
          {series && (
            <p className="mt-0.5 truncate text-[11px] font-semibold text-primary" title={`${series.name}${series.index != null ? `, ${seriesNumberLabel(series.index)}` : ""}`}>
              {series.name}
              {series.index != null && ` · ${Number(series.index.toFixed(2))}`}
            </p>
          )}
        </div>
        <BookMenu book={book} actions={menuActions} className="-mr-1 -mt-1 shrink-0" />
      </div>
      <div>
        <div className="h-1.5 w-full rounded-full bg-surface-container-highest">
          <div
            className={`h-1.5 rounded-full ${finished ? "bg-tertiary" : "bg-primary"}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className={`mt-2 text-right text-[10px] font-bold uppercase tracking-tighter ${finished ? "text-tertiary" : "text-on-surface-variant"}`}>
          {finished ? "Finished" : `${progressPercent}%`}
        </p>
      </div>
    </article>
  );
};

export const BookCard = memo(BookCardComponent);
