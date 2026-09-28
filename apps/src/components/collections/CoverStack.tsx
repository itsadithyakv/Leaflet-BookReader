import type { Book } from "@shared/models/book";
import { useCoverSrc } from "../../hooks/useCoverSrc";

const StackedCover = ({ book, offset, total }: { book: Book; offset: number; total: number }) => {
  const { src, onError } = useCoverSrc(book, { thumb: true });
  return (
    <div
      className="book-cover-frame absolute top-0 h-full w-[58%] overflow-hidden bg-surface-container-high shadow-md"
      style={{ left: `${offset * (42 / Math.max(1, total - 1))}%`, zIndex: total - offset }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={onError} />
      ) : (
        <div className="flex h-full items-center justify-center p-1 text-center text-[9px] leading-tight text-on-surface-variant">
          {book.title}
        </div>
      )}
    </div>
  );
};

/** Up to three covers fanned out, first on top: the face of a series or shelf. */
export const CoverStack = ({ books, className = "" }: { books: Book[]; className?: string }) => {
  const shown = books.slice(0, 3);
  return (
    <div className={`relative aspect-[16/10] ${className}`} aria-hidden="true">
      {shown.length === 0 ? (
        <div className="book-cover-frame h-full w-[58%] border-dashed bg-surface-container" />
      ) : (
        shown.map((book, offset) => <StackedCover key={book.id} book={book} offset={offset} total={shown.length} />)
      )}
    </div>
  );
};
