import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { Book } from "@shared/models/book";
import { bookService } from "../services/bookService";

type Props = {
  book: Book;
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
};

export const BookCard = ({ book, onRefresh, onOpen }: Props) => {
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
    void bookService.coverData(book.id).then((data) => {
      if (data) {
        setFallbackSrc(data);
      }
    });
  }, [book.id, book.coverUrl]);

  const handleCoverError = () => {
    if (triedFallback.current) {
      return;
    }
    triedFallback.current = true;
    void bookService.coverData(book.id).then((data) => {
      if (data) {
        setFallbackSrc(data);
      }
    });
  };

  const resolvedCover = fallbackSrc ?? coverSrc;
  const progressPercent = Math.round(Math.min(1, Math.max(0, book.progress)) * 100);
  const isFinished = progressPercent >= 100;

  return (
    <article
      onClick={() => onOpen(book)}
      className="group flex h-full w-full cursor-pointer flex-col text-left transition-transform duration-300 hover:-translate-y-2"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/5 shadow-[0_20px_40px_rgba(0,0,0,0.55)] transition-all duration-300 group-hover:shadow-[0_28px_60px_rgba(0,0,0,0.65)] group-hover:border-primary/30 group-hover:ring-1 group-hover:ring-primary/40">
        {resolvedCover ? (
          <img
            src={resolvedCover}
            alt={book.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            onError={handleCoverError}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-surface-container-high text-xs text-on-surface-variant">
            No cover yet
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="absolute inset-0 flex items-end p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <button
            type="button"
            className="w-full rounded-lg bg-white/20 py-2 text-sm font-bold text-white shadow-[0_0_14px_rgba(101,168,63,0.35)] backdrop-blur-md transition hover:bg-white/30"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(book);
            }}
          >
            Resume Reading
          </button>
        </div>
      </div>
      <div className="flex-1 pt-4">
        <p className="truncate font-headline text-base font-bold text-on-surface">{book.title}</p>
        <p className="text-xs text-on-surface-variant">{book.author ?? "Unknown author"}</p>
      </div>
      <div>
        <div className="h-1.5 w-full rounded-full bg-surface-container-highest">
          <div
            className={`h-1.5 rounded-full ${isFinished ? "bg-tertiary" : "bg-primary"} shadow-[0_0_8px_rgba(101,168,63,0.6)]`}
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
