import { useLayoutEffect, useRef, useState } from "react";
import type { Book } from "@shared/models/book";
import { BookCard } from "./BookCard";
import type { BookMenuAction } from "./BookMenu";
import { VirtualRows } from "./VirtualRows";
import { getPlatform } from "../platform";
import { gridColumns } from "../library/gridColumns";

/** Libraries up to this size render in full; larger ones draw only what is on screen. */
export const VIRTUALIZE_FROM = 60;

type Props = {
  books: Book[];
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
  /** More entries for each card's menu. */
  menuActions?: (book: Book) => BookMenuAction[];
};

/**
 * The grid's columns, from its own width (see `gridColumns`). Measured before
 * the first paint and again whenever the grid's width changes, which is more
 * often than the window's does: the page has a widest size, and the rail and
 * the bottom bar take different amounts.
 */
const useColumns = (gap: number) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(() => gridColumns(window.innerWidth, gap));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const update = () => setColumns(gridColumns(element.clientWidth, gap));
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [gap]);
  return [ref, columns] as const;
};

export const BookGrid = ({ books, onRefresh, onOpen, menuActions }: Props) => {
  const gap = getPlatform() === "mobile" ? 24 : 32;
  const [ref, columns] = useColumns(gap);
  const columnStyle = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  if (books.length <= VIRTUALIZE_FROM) {
    return (
      <div ref={ref} className="grid" style={{ ...columnStyle, gap }}>
        {books.map((book) => (
          <BookCard key={book.id} book={book} onRefresh={onRefresh} onOpen={onOpen} menuActions={menuActions?.(book)} />
        ))}
      </div>
    );
  }

  return (
    <div ref={ref}>
      <VirtualRows
        count={Math.ceil(books.length / columns)}
        estimate={360}
        gap={gap}
        renderRow={(row) => (
          <div className="grid" style={{ ...columnStyle, columnGap: gap }}>
            {books.slice(row * columns, row * columns + columns).map((book) => (
              <BookCard key={book.id} book={book} onRefresh={onRefresh} onOpen={onOpen} menuActions={menuActions?.(book)} />
            ))}
          </div>
        )}
      />
    </div>
  );
};
