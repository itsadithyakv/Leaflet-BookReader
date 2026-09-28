import { isTauri } from "@tauri-apps/api/core";
import { memo, useEffect, useRef, useState } from "react";
import type { Book } from "@shared/models/book";
import { bookService } from "../services/bookService";

type Props = {
  book: Book;
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
};

const BookCardComponent = ({ book, onRefresh, onOpen }: Props) => {
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const triedFallback = useRef(false);

  const coverSrc = book.coverUrl
    ? !isTauri() && book.coverUrl.startsWith("http")
      ? book.coverUrl
      : null
    : null;

  useEffect(() => {
    triedFallback.current = false;
    setFallbackSrc(null);
  }, [book.id, book.coverUrl]);

  useEffect(() => {
    if (!isTauri() || !book.coverUrl || book.coverUrl.startsWith("http")) {
      return;
    }
    bookService
      .coverData(book.id)
      .then((data) => {
        if (data) {
          setFallbackSrc(data);
        }
      })
      // A missing or unreadable cover just leaves the placeholder.
      .catch(() => undefined);
  }, [book.id, book.coverUrl]);

  const handleCoverError = () => {
    if (triedFallback.current) {
      return;
    }
    triedFallback.current = true;
    bookService
      .coverData(book.id)
      .then((data) => {
        if (data) {
          setFallbackSrc(data);
        }
      })
      // A missing or unreadable cover just leaves the placeholder.
      .catch(() => undefined);
  };

  const resolvedCover = fallbackSrc ?? coverSrc;
  const progressPercent = Math.round(Math.min(1, Math.max(0, book.progress)) * 100);
  const isFinished = progressPercent >= 100;
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
      <div className="book-cover-frame relative aspect-[2/3] w-full overflow-hidden transition-all duration-200 group-hover:border-primary/50">
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
      <div className="flex-1 pt-4">
        <p className="book-title truncate text-lg text-on-surface">{book.title}</p>
        <p className="text-xs text-on-surface-variant">{book.author ?? "Unknown author"}</p>
      </div>
      <div>
        <div className="h-1.5 w-full rounded-full bg-surface-container-highest">
          <div
            className={`h-1.5 rounded-full ${isFinished ? "bg-tertiary" : "bg-primary"}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className={`mt-2 text-right text-[10px] font-bold uppercase tracking-tighter ${isFinished ? "text-tertiary" : "text-on-surface-variant"}`}>
          {isFinished ? "Finished" : `${progressPercent}%`}
        </p>
      </div>
    </article>
  );
};

export const BookCard = memo(BookCardComponent);
