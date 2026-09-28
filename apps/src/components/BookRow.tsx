import { memo, useState } from "react";
import type { Book } from "@shared/models/book";
import { useCoverSrc } from "../hooks/useCoverSrc";
import { useSeriesInfo } from "../library/useSeries";
import { BookMenu } from "./BookMenu";

type Props = {
  book: Book;
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
  onRemove: (book: Book) => void;
};

const BookRowComponent = ({ book, onRefresh, onOpen, onRemove }: Props) => {
  // Removing a book removes it from every device, so it asks once first.
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { src: resolvedCover, onError: handleCoverError } = useCoverSrc(book, { thumb: true });
  const series = useSeriesInfo(book.id);
  const progressPercent = Math.round(Math.min(1, Math.max(0, book.progress)) * 100);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${book.title}${book.author ? ` by ${book.author}` : ""}`}
      onClick={() => onOpen(book)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen(book);
        }
      }}
      className="ledger-row flex cursor-pointer items-center gap-4 p-3 transition"
    >
      <div className="book-cover-frame h-16 w-12 overflow-hidden bg-surface-container-high">
        {resolvedCover ? (
          <img src={resolvedCover} alt={book.title} className="h-full w-full object-cover" onError={handleCoverError} />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-on-surface-variant">
            No cover
          </div>
        )}
      </div>
      <div className="flex-1">
        <p className="book-title text-base text-on-surface">{book.title}</p>
        <p className="text-xs text-on-surface-variant">
          {book.author ?? "Unknown author"}
          {series && (
            <span className="font-semibold text-primary">
              {" · "}
              {series.name}
              {series.index != null && ` ${Number(series.index.toFixed(2))}`}
            </span>
          )}
          {/* Listed here but not downloaded: sync moves the index, not the files. */}
          {book.available === false && " · downloads when opened"}
        </p>
      </div>
      <div className="w-32">
        <div className="h-1.5 w-full rounded-full bg-surface-container-highest">
          <div
            className="h-1.5 rounded-full bg-primary"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-1 text-right text-[10px] font-bold uppercase tracking-tighter text-on-surface-variant">
          {progressPercent}%
        </p>
      </div>
      <BookMenu book={book} />
      <button
        className="tactile-button px-3 py-2 text-xs"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRefresh(book.id);
        }}
      >
        Refresh
      </button>
      <button
        className="tactile-button px-3 py-2 text-xs"
        type="button"
        title={
          confirmRemove
            ? "Removes this book from every synced device"
            : "Remove from library"
        }
        onClick={(e) => {
          e.stopPropagation();
          if (!confirmRemove) {
            setConfirmRemove(true);
            return;
          }
          setConfirmRemove(false);
          onRemove(book);
        }}
        onBlur={() => setConfirmRemove(false)}
      >
        {confirmRemove ? "Confirm" : "Remove"}
      </button>
    </div>
  );
};

export const BookRow = memo(BookRowComponent);
