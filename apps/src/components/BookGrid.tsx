import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Book } from "@shared/models/book";
import { BookCard } from "./BookCard";
import type { BookMenuAction } from "./BookMenu";
import { VirtualRows } from "./VirtualRows";
import { getPlatform } from "../platform";
import { coverWidth, gridColumns, gridShape } from "../library/gridColumns";
import { useMediaQuery } from "../hooks/useMediaQuery";

/** Libraries up to this size render in full; larger ones draw only what is on screen. */
export const VIRTUALIZE_FROM = 60;

/** Measured before the first paint in the page; an effect when drawn to markup (the tests). */
const useIsomorphicLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

type Props = {
  books: Book[];
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
  /** More entries for each card's menu. */
  menuActions?: (book: Book) => BookMenuAction[];
  /** Told a book's title once its menu has removed it. */
  onRemoved?: (title: string) => void;
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
  // A cover's width, rounded up to 10 px so a window dragged wider does not redraw every card each pixel.
  const [cover, setCover] = useState(() => Math.ceil(coverWidth(window.innerWidth, gap) / 10) * 10);
  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const update = () => {
      // No width is no layout (a kept page while hidden, pages/LibraryPage.tsx): the columns stay as they were,
      // so the rows are not drawn again for a width of nothing, and again when it comes back.
      const shape = gridShape(element.clientWidth, gap);
      if (shape) {
        setColumns(shape.columns);
        setCover(shape.cover);
      }
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [gap]);
  return [ref, columns, `${cover}px`] as const;
};

export const BookGrid = ({ books, onRefresh, onOpen, menuActions, onRemoved }: Props) => {
  // An upright phone by a finger has two covers to a row (360 to 430 px): a narrow gutter gives the room to the covers.
  const phone = useMediaQuery("(hover: none) and (pointer: coarse) and (max-width: 767px)");
  const gap = phone ? 14 : getPlatform() === "mobile" ? 24 : 32;
  const [ref, columns, coverSizes] = useColumns(gap);
  const columnStyle = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  if (books.length <= VIRTUALIZE_FROM) {
    return (
      <div ref={ref} className="grid" style={{ ...columnStyle, gap }}>
        {books.map((book) => (
          <BookCard key={book.id} book={book} onRefresh={onRefresh} onOpen={onOpen} menuActions={menuActions?.(book)} onRemoved={onRemoved} coverSizes={coverSizes} />
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
              <BookCard key={book.id} book={book} onRefresh={onRefresh} onOpen={onOpen} menuActions={menuActions?.(book)} onRemoved={onRemoved} coverSizes={coverSizes} />
            ))}
          </div>
        )}
      />
    </div>
  );
};
