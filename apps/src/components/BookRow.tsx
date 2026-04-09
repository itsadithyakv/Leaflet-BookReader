import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { Book } from "@shared/models/book";
import { bookService } from "../services/bookService";

type Props = {
  book: Book;
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
};

export const BookRow = ({ book, onRefresh, onOpen }: Props) => {
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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(book)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(book)}
      className="flex cursor-pointer items-center gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-3 transition hover:bg-surface-container-high"
    >
      <div className="h-16 w-12 overflow-hidden rounded-xl bg-surface-container-high">
        {resolvedCover ? (
          <img src={resolvedCover} alt={book.title} className="h-full w-full object-cover" onError={handleCoverError} />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-on-surface-variant">
            No cover
          </div>
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm font-headline font-semibold text-on-surface">{book.title}</p>
        <p className="text-xs text-on-surface-variant">{book.author ?? "Unknown author"}</p>
      </div>
      <div className="w-32">
        <div className="h-1.5 w-full rounded-full bg-surface-container-highest">
          <div
            className="h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(101,168,63,0.6)]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-1 text-right text-[10px] font-bold uppercase tracking-tighter text-on-surface-variant">
          {progressPercent}%
        </p>
      </div>
      <button
        className="text-xs text-on-surface-variant transition hover:text-on-surface"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRefresh(book.id);
        }}
      >
        Refresh
      </button>
    </div>
  );
};
