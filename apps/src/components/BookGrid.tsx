import { useEffect, useState } from "react";
import type { Book } from "@shared/models/book";
import { BookCard } from "./BookCard";
import type { BookMenuAction } from "./BookMenu";
import { VirtualRows } from "./VirtualRows";
import { getPlatform } from "../platform";

const GRID_CLASSES =
  "grid gap-8 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";

const MOBILE_GRID_CLASSES = "grid gap-6 grid-cols-2 sm:grid-cols-3";

/** Libraries up to this size render in full; larger ones draw only what is on screen. */
export const VIRTUALIZE_FROM = 60;

type Props = {
  books: Book[];
  onRefresh: (id: string) => void;
  onOpen: (book: Book) => void;
  /** More entries for each card's menu. */
  menuActions?: (book: Book) => BookMenuAction[];
};

/** The same columns as the grid classes above, for the rows drawn by hand. */
const columnsFor = (width: number, mobile: boolean) =>
  mobile ? (width >= 640 ? 3 : 2) : width >= 1024 ? 5 : width >= 640 ? 3 : 2;

const useColumns = (mobile: boolean) => {
  const [columns, setColumns] = useState(() => columnsFor(window.innerWidth, mobile));
  useEffect(() => {
    const update = () => setColumns(columnsFor(window.innerWidth, mobile));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [mobile]);
  return columns;
};

export const BookGrid = ({ books, onRefresh, onOpen, menuActions }: Props) => {
  const mobile = getPlatform() === "mobile";
  const gridClass = mobile ? MOBILE_GRID_CLASSES : GRID_CLASSES;
  const columns = useColumns(mobile);

  if (books.length <= VIRTUALIZE_FROM) {
    return (
      <div className={gridClass}>
        {books.map((book) => (
          <BookCard key={book.id} book={book} onRefresh={onRefresh} onOpen={onOpen} menuActions={menuActions?.(book)} />
        ))}
      </div>
    );
  }

  const gap = mobile ? 24 : 32;
  return (
    <VirtualRows
      count={Math.ceil(books.length / columns)}
      estimate={360}
      gap={gap}
      renderRow={(row) => (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: gap }}>
          {books.slice(row * columns, row * columns + columns).map((book) => (
            <BookCard key={book.id} book={book} onRefresh={onRefresh} onOpen={onOpen} menuActions={menuActions?.(book)} />
          ))}
        </div>
      )}
    />
  );
};
